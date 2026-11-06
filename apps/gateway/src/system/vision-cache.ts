// ---------------------------------------------------------------------------
// Vision image cache
// ---------------------------------------------------------------------------
//
// Preparing an image is expensive: it decodes, crops, rescales and re-encodes
// with @napi-rs/canvas. `hydrateVisionHistory` needs the same prepared bytes on
// every turn, so without a cache the same source file is decoded and encoded
// again for the lifetime of the conversation. This keeps the finished,
// base64-ready result in memory instead.
//
// The key is the sha256 of the *prepared* bytes, which `prepareImage` already
// returns. Different crops or detail levels of one source therefore hash
// differently and never collide, so no composite keys are needed.
//
// Bounded by both an entry count and a byte budget. Map preserves insertion
// order, so the first key is the oldest; `get` re-inserts to mark it recent.

export interface CachedImage {
  b64: string; // base64 of prepared bytes, ready for a data: URL
  mime: string; // prepared mime, e.g. 'image/png'
  width: number;
  height: number;
  bytes: number; // prepared byte length (not base64 length)
}

export interface VisionCacheStats {
  hits: number;
  misses: number;
  entries: number;
  bytes: number;
}

export const MAX_BYTES = 128 * 1024 * 1024;
export const MAX_ENTRIES = 64;

class VisionCache {
  private readonly entries = new Map<string, CachedImage>();
  private totalBytes = 0;
  private hits = 0;
  private misses = 0;

  /** Returns the cached image and marks it as recently used. */
  get(sha: string): CachedImage | undefined {
    const image = this.entries.get(sha);
    if (!image) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    // Touch: re-insert so this entry is now the most recently used.
    this.entries.delete(sha);
    this.entries.set(sha, image);
    return image;
  }

  /** Inserts (or replaces) an entry, then evicts the oldest until in budget. */
  set(sha: string, img: CachedImage): void {
    const existing = this.entries.get(sha);
    if (existing) {
      // Replacing: drop the old byte count and re-insert to reset recency.
      this.totalBytes -= existing.bytes;
      this.entries.delete(sha);
    }
    this.entries.set(sha, img);
    this.totalBytes += img.bytes;
    this.evict();
  }

  has(sha: string): boolean {
    return this.entries.has(sha);
  }

  stats(): VisionCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      bytes: this.totalBytes,
    };
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  private evict(): void {
    while (this.totalBytes > MAX_BYTES || this.entries.size > MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) this.totalBytes -= oldest.bytes;
      this.entries.delete(oldestKey);
    }
  }
}

export const visionCache = new VisionCache();