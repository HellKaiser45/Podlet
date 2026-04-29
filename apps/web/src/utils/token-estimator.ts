/**
 * Rough token estimation utilities.
 * Uses chars/4 for text (industry standard approximation).
 * Uses pixel-based formula for images.
 */

/** Maximum tokens allowed for user input + attachments */
export const MAX_USER_TOKEN_BUDGET = 50_000;

/** Estimate tokens from text content */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate tokens from an image based on dimensions.
 *  Uses a simplified formula that works for both OpenAI and Anthropic:
 *  Roughly width * height / 750, clamped between 85 and 5000
 */
export function estimateImageTokens(width: number, height: number): number {
  const tokens = Math.ceil((width * height) / 750);
  return Math.max(85, Math.min(tokens, 5000));
}

/** Get image dimensions from a File */
function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      resolve({ width: 1024, height: 1024 }); // fallback estimate
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

/** Estimate tokens for a single file attachment */
export async function estimateFileTokens(file: File): Promise<number> {
  if (file.type.startsWith('image/')) {
    const { width, height } = await getImageDimensions(file);
    return estimateImageTokens(width, height);
  }
  // Text file: use file size
  return Math.ceil(file.size / 4);
}

/** Estimate total tokens for a message + its attachments */
export async function estimateTotalTokens(
  message: string,
  files: File[]
): Promise<{ total: number; breakdown: { message: number; attachments: number } }> {
  const messageTokens = estimateTextTokens(message);
  let attachmentTokens = 0;

  for (const file of files) {
    attachmentTokens += await estimateFileTokens(file);
  }

  return {
    total: messageTokens + attachmentTokens,
    breakdown: { message: messageTokens, attachments: attachmentTokens },
  };
}
