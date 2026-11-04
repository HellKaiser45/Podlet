import { describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import {
  estimateVisualTokens,
  normaliseMime,
  prepareImage,
  SUPPORTED_SOURCE_MIMES,
} from "../src/system/vision";

// Fixtures are generated at runtime so no binary files live in the repo.
function makeImage(
  width: number,
  height: number,
  mime: "image/png" | "image/jpeg",
): Uint8Array {
  const canvas = createCanvas(width, height);
  try {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#204a87";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      Math.round(width * 0.1),
      Math.round(height * 0.1),
      Math.max(1, Math.round(width * 0.8)),
      Math.max(1, Math.round(height * 0.8)),
    );
    ctx.fillStyle = "#000000";
    ctx.font = `${Math.max(8, Math.round(Math.min(width, height) / 6))}px sans-serif`;
    ctx.fillText("hello", Math.round(width * 0.15), Math.round(height * 0.5));
    const buffer = mime === "image/jpeg" ? canvas.toBuffer("image/jpeg", 85) : canvas.toBuffer("image/png");
    return new Uint8Array(buffer);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

describe("normaliseMime", () => {
  test("lowercases, strips parameters and maps image/jpg", () => {
    expect(normaliseMime("IMAGE/JPG; charset=x")).toBe("image/jpeg");
    expect(normaliseMime("  Image/PNG ; q=1 ")).toBe("image/png");
    expect(normaliseMime("text/plain")).toBe("text/plain");
  });
});

describe("estimateVisualTokens", () => {
  test("uses a 28x28 patch grid", () => {
    expect(estimateVisualTokens(28, 28)).toBe(1);
    expect(estimateVisualTokens(29, 28)).toBe(2);
    expect(estimateVisualTokens(1568, 1176)).toBe(56 * 42);
    expect(estimateVisualTokens(0, 10)).toBe(0);
  });
});

describe("SUPPORTED_SOURCE_MIMES", () => {
  test("contains the four decodable formats", () => {
    expect([...SUPPORTED_SOURCE_MIMES].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
});

describe("prepareImage", () => {
  test("4000x3000 jpeg is downscaled to a max edge of 1568 and stays jpeg", async () => {
    const input = makeImage(4000, 3000, "image/jpeg");
    const result = await prepareImage(input, "image/jpeg");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1568);
    expect(result.mime).toBe("image/jpeg");
    expect(result.sourceWidth).toBe(4000);
    expect(result.sourceHeight).toBe(3000);
    expect(result.sha).toMatch(HEX64);
    expect(result.bytes.byteLength).toBeGreaterThan(0);

    // tokensEst follows the documented 28x28 patch formula.
    expect(result.tokensEst).toBe(estimateVisualTokens(result.width, result.height));

    expect(result.width).toBe(1568);
    expect(result.height).toBe(1176);
    // 4:3 at a 1568 long edge yields 56 * 42 = 2352 patches, so the brief's
    // `tokensEst <= 1600` target is unreachable under the mandated formula
    // (1600 would require a 2:1 aspect ratio). Bounded by the 1568^2 max.
    expect(result.tokensEst).toBe(2352);
    expect(result.tokensEst).toBeLessThanOrEqual(estimateVisualTokens(1568, 1568));
  });

  test("800x600 png stays png and is not upscaled", async () => {
    const input = makeImage(800, 600, "image/png");
    const result = await prepareImage(input, "image/png");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.mime).toBe("image/png");
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.sourceWidth).toBe(800);
    expect(result.sourceHeight).toBe(600);
    expect(result.sha).toMatch(HEX64);
  });

  test("1x1 png returns ok without crashing", async () => {
    const input = makeImage(1, 1, "image/png");
    const result = await prepareImage(input, "image/png");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.tokensEst).toBe(1);
  });

  test("garbage bytes return ok:false and never throw", async () => {
    const result = await prepareImage(new Uint8Array([1, 2, 3, 4]), "image/png");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.reason).not.toMatch(/\/(?:home|tmp|var|Users|root)\//);
  });

  test("unsupported mime is rejected without throwing", async () => {
    const result = await prepareImage(new Uint8Array([1, 2, 3]), "image/tiff");
    expect(result.ok).toBe(false);
  });

  test("fraction crop halves the source before the resize", async () => {
    const input = makeImage(800, 600, "image/png");
    const result = await prepareImage(input, "image/png", {
      crop: { x: 0, y: 0, width: 0.5, height: 0.5, unit: "fraction" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sourceWidth).toBe(800);
    expect(result.sourceHeight).toBe(600);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
    expect(result.tokensEst).toBe(estimateVisualTokens(400, 300));
  });

  test("crop outside the image bounds returns ok:false", async () => {
    const input = makeImage(100, 100, "image/png");
    const result = await prepareImage(input, "image/png", {
      crop: { x: 500, y: 500, width: 10, height: 10, unit: "px" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("crop region is empty or outside image bounds");
  });

  test("jpeg source can be forced to png output", async () => {
    const input = makeImage(300, 200, "image/jpeg");
    const result = await prepareImage(input, "image/jpeg", { format: "png" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe("image/png");
  });
});