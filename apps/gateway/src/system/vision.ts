import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface CropSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: "px" | "fraction";
}

interface PrepareOptions {
  /** Longest edge of the returned image. Default 1568. Downscale only. */
  maxEdge?: number;
  /** Output format. Defaults to png for png/gif/webp sources, jpeg for jpeg sources. */
  format?: "png" | "jpeg";
  /** JPEG quality 0-100. Default 82. Ignored for png. */
  quality?: number;
  /** Crop region, applied BEFORE the resize. */
  crop?: CropSpec;
}

export interface PreparedImage {
  ok: true;
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  /** sha256 hex of the returned `bytes`. */
  sha: string;
  tokensEst: number;
}

type PrepareResult = PreparedImage | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_EDGE = 1568;
const DEFAULT_JPEG_QUALITY = 82;

/** Source formats this module can decode. Anything else is rejected up front. */
const SUPPORTED_SOURCE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// ---------------------------------------------------------------------------
// MIME helpers
// ---------------------------------------------------------------------------

/**
 * Canonicalise a MIME string: strip parameters, lowercase, trim, and map the
 * non-standard `image/jpg` alias onto `image/jpeg`.
 */
export function normaliseMime(mime: string): string {
  if (typeof mime !== "string") return "";
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "image/jpg" ? "image/jpeg" : base;
}

// ---------------------------------------------------------------------------
// Token estimate
// ---------------------------------------------------------------------------

/**
 * Estimate visual tokens as a 28x28 patch grid. This models Anthropic's
 * 28x28 patch grid and is an estimate (+/-15%), used only for display and
 * budgeting — never for billing or hard limits.
 */
function estimateVisualTokens(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 0;
  }
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Region {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * @napi-rs/canvas `loadImage` does not reject on unrecognised bytes: it hangs
 * forever, which would leak a never-settling promise out of `prepareImage`.
 * Sniffing the container signature first turns that into a clean failure.
 */
function sniffImageMime(bytes: Uint8Array): PreparedImage["mime"] | null {
  const has = (signature: number[], offset = 0): boolean =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte);

  // PNG: \x89PNG\r\n\x1a\n
  if (has([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // JPEG: SOI marker FF D8 FF
  if (has([0xff, 0xd8, 0xff])) return "image/jpeg";
  // GIF: "GIF87a" / "GIF89a"
  if (has([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // WEBP: "RIFF" .... "WEBP"
  if (has([0x52, 0x49, 0x46, 0x46]) && has([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";

  return null;
}

/** Keep error text free of anything that looks like an absolute filesystem path. */
function safeReason(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const cleaned = raw.replace(/(?:[A-Za-z]:\\|\/)[^\s'"]*/g, "<path>").trim();
  return cleaned ? `${fallback}: ${cleaned}`.slice(0, 200) : fallback;
}

/**
 * Resolve a CropSpec against the source dimensions and clamp it to the image.
 * Returns null when the region is empty or entirely outside the image.
 */
function resolveCropRegion(
  crop: CropSpec,
  sourceWidth: number,
  sourceHeight: number,
): Region | null {
  const scaleX = crop.unit === "fraction" ? sourceWidth : 1;
  const scaleY = crop.unit === "fraction" ? sourceHeight : 1;

  const left = crop.x * scaleX;
  const top = crop.y * scaleY;
  const width = crop.width * scaleX;
  const height = crop.height * scaleY;

  if (![left, top, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;

  const x0 = Math.max(0, Math.round(left));
  const y0 = Math.max(0, Math.round(top));
  const x1 = Math.min(sourceWidth, Math.round(left + width));
  const y1 = Math.min(sourceHeight, Math.round(top + height));

  const sw = x1 - x0;
  const sh = y1 - y0;
  if (sw < 1 || sh < 1) return null;

  return { sx: x0, sy: y0, sw, sh };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// prepareImage
// ---------------------------------------------------------------------------

/**
 * Decode, crop, downscale and re-encode an image. Pure: bytes in, bytes out —
 * no filesystem access. Never throws.
 */
export async function prepareImage(
  input: Uint8Array,
  mime: string,
  opts: PrepareOptions = {},
): Promise<PrepareResult> {
  try {
    let sourceMime = normaliseMime(mime);
    if (!SUPPORTED_SOURCE_MIMES.has(sourceMime)) {
      return {
        ok: false,
        reason: sourceMime
          ? `unsupported image format "${sourceMime}" (supported: ${[...SUPPORTED_SOURCE_MIMES].join(", ")})`
          : "missing or empty image MIME type",
      };
    }

    if (!input || input.byteLength === 0) {
      return { ok: false, reason: "image data is empty" };
    }

    const sniffedMime = sniffImageMime(input);
    if (!sniffedMime) {
      return {
        ok: false,
        reason:
          "could not decode image data: unrecognised image header (expected png, jpeg, webp or gif)",
      };
    }

    // The bytes are authoritative; the declared MIME only gated decodability.
    sourceMime = sniffedMime;

    const requestedEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
    const maxEdge =
      Number.isFinite(requestedEdge) && requestedEdge >= 1
        ? Math.floor(requestedEdge)
        : DEFAULT_MAX_EDGE;

    const requestedQuality = opts.quality ?? DEFAULT_JPEG_QUALITY;
    const quality = Number.isFinite(requestedQuality)
      ? Math.min(100, Math.max(1, Math.round(requestedQuality)))
      : DEFAULT_JPEG_QUALITY;

    const image = await loadImage(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
    const sourceWidth = Number(image.width);
    const sourceHeight = Number(image.height);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      return { ok: false, reason: "decoded image has zero width or height" };
    }

    // --- crop (before resize) ---------------------------------------------
    let region: Region = { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
    if (opts.crop) {
      const crop = opts.crop;
      if (crop.unit !== "px" && crop.unit !== "fraction") {
        return { ok: false, reason: `invalid crop unit "${String(crop.unit)}"` };
      }
      const resolved = resolveCropRegion(crop, sourceWidth, sourceHeight);
      if (!resolved) {
        return { ok: false, reason: "crop region is empty or outside image bounds" };
      }
      region = resolved;
    }

    // --- resize (downscale only) ------------------------------------------
    let outWidth = region.sw;
    let outHeight = region.sh;
    const longestEdge = Math.max(region.sw, region.sh);
    if (longestEdge > maxEdge) {
      const scale = maxEdge / longestEdge;
      outWidth = Math.max(1, Math.round(region.sw * scale));
      outHeight = Math.max(1, Math.round(region.sh * scale));
    }

    // --- target format -----------------------------------------------------
    const requestedFormat =
      opts.format ?? (sourceMime === "image/jpeg" ? "jpeg" : "png");
    const targetMime: PreparedImage["mime"] =
      requestedFormat === "jpeg" ? "image/jpeg" : "image/png";

    // Nothing to do at all: no crop, no downscale, and the source is already
    // a format we can forward (png/jpeg). Hand back the untouched bytes.
    const isCropped = region.sw !== sourceWidth || region.sh !== sourceHeight;
    const isResized = outWidth !== region.sw || outHeight !== region.sh;
    if (!isCropped && !isResized && targetMime === sourceMime) {
      const bytes = new Uint8Array(input);
      return {
        ok: true,
        bytes,
        mime: sourceMime as PreparedImage["mime"],
        width: sourceWidth,
        height: sourceHeight,
        sourceWidth,
        sourceHeight,
        sha: sha256Hex(bytes),
        tokensEst: estimateVisualTokens(sourceWidth, sourceHeight),
      };
    }

    // --- draw + encode -----------------------------------------------------
    const canvas = createCanvas(outWidth, outHeight);
    let bytes: Uint8Array;
    try {
      const ctx = canvas.getContext("2d");
      // JPEG has no alpha channel: paint white so transparent PNGs do not
      // come out with black backgrounds.
      if (targetMime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, outWidth, outHeight);
      }
      ctx.drawImage(
        image,
        region.sx,
        region.sy,
        region.sw,
        region.sh,
        0,
        0,
        outWidth,
        outHeight,
      );
      const buffer =
        targetMime === "image/jpeg"
          ? canvas.toBuffer("image/jpeg", quality)
          : canvas.toBuffer("image/png");
      bytes = new Uint8Array(buffer);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }

    return {
      ok: true,
      bytes,
      mime: targetMime,
      width: outWidth,
      height: outHeight,
      sourceWidth,
      sourceHeight,
      sha: sha256Hex(bytes),
      tokensEst: estimateVisualTokens(outWidth, outHeight),
    };
  } catch (err) {
    return { ok: false, reason: safeReason(err, "could not decode image data") };
  }
}