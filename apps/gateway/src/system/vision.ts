import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// prepareImage
// ---------------------------------------------------------------------------

/**
 * Decode, downscale to a 1568px longest edge and re-encode an image. Pure:
 * bytes in, bytes out — no filesystem access. Never throws.
 */
export async function prepareImage(input: Uint8Array, mime: string): Promise<PrepareResult> {
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

    const image = await loadImage(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
    const sourceWidth = Number(image.width);
    const sourceHeight = Number(image.height);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      return { ok: false, reason: "decoded image has zero width or height" };
    }

    // --- resize (downscale only) ------------------------------------------
    let outWidth = sourceWidth;
    let outHeight = sourceHeight;
    const longestEdge = Math.max(sourceWidth, sourceHeight);
    if (longestEdge > DEFAULT_MAX_EDGE) {
      const scale = DEFAULT_MAX_EDGE / longestEdge;
      outWidth = Math.max(1, Math.round(sourceWidth * scale));
      outHeight = Math.max(1, Math.round(sourceHeight * scale));
    }

    // --- target format -----------------------------------------------------
    const targetMime: PreparedImage["mime"] =
      sourceMime === "image/jpeg" ? "image/jpeg" : "image/png";

    // Nothing to do at all: no downscale, and the source is already a format
    // we can forward (png/jpeg). Hand back the untouched bytes.
    const isResized = outWidth !== sourceWidth || outHeight !== sourceHeight;
    if (!isResized && targetMime === sourceMime) {
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
        0,
        0,
        sourceWidth,
        sourceHeight,
        0,
        0,
        outWidth,
        outHeight,
      );
      const buffer =
        targetMime === "image/jpeg"
          ? canvas.toBuffer("image/jpeg", DEFAULT_JPEG_QUALITY)
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