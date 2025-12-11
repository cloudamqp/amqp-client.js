/**
 * Supported compression algorithms
 */
export type CompressionAlgorithm = "lz4" | "snappy" | "zstd" | "gzip"

/**
 * Codec interface for compression/decompression
 */
export interface CompressionCodec {
  /** Compress data */
  compress(data: Uint8Array): Uint8Array
  /** Decompress data */
  decompress(data: Uint8Array): Uint8Array
  /** Content-Encoding header value */
  readonly contentEncoding: string
}

/**
 * Options for publish with compression
 */
export interface PublishOptions {
  /** Compression algorithm to use */
  compression?: CompressionAlgorithm
  /** Minimum body size in bytes before compression is applied (default: 0) */
  compressionThreshold?: number
}

/**
 * Error thrown when a required compression codec is not available
 */
export class CompressionError extends Error {
  constructor(
    message: string,
    public readonly algorithm?: CompressionAlgorithm,
  ) {
    super(message)
    this.name = "CompressionError"
  }
}

/**
 * Registry for compression codecs with lazy loading
 */
class CompressionRegistry {
  private codecs = new Map<string, CompressionCodec | null>()
  private loadPromises = new Map<string, Promise<CompressionCodec | null>>()

  /**
   * Get a codec by algorithm name, loading it if necessary
   * Returns null if the codec library is not installed
   */
  async getCodec(algorithm: CompressionAlgorithm): Promise<CompressionCodec | null> {
    // Check cache first
    if (this.codecs.has(algorithm)) {
      return this.codecs.get(algorithm) || null
    }

    // Check if already loading
    if (this.loadPromises.has(algorithm)) {
      return this.loadPromises.get(algorithm)!
    }

    // Start loading
    const loadPromise = this.loadCodec(algorithm)
    this.loadPromises.set(algorithm, loadPromise)

    const codec = await loadPromise
    this.codecs.set(algorithm, codec)
    this.loadPromises.delete(algorithm)

    return codec
  }

  /**
   * Register a custom codec
   */
  registerCodec(contentEncoding: string, codec: CompressionCodec): void {
    this.codecs.set(contentEncoding, codec)
  }

  /**
   * Get a codec synchronously (only returns already-loaded codecs)
   * Returns null if the codec is not loaded yet
   */
  getCodecSync(algorithm: string): CompressionCodec | null {
    return this.codecs.get(algorithm) || null
  }

  private async loadCodec(algorithm: CompressionAlgorithm): Promise<CompressionCodec | null> {
    try {
      switch (algorithm) {
        case "gzip":
          return await this.loadGzip()
        case "lz4":
          return await this.loadLz4()
        case "snappy":
          return await this.loadSnappy()
        case "zstd":
          return await this.loadZstd()
        default:
          return null
      }
    } catch {
      return null
    }
  }

  private async loadGzip(): Promise<CompressionCodec> {
    // Use built-in zlib in Node.js, pako in browser
    if (typeof process !== "undefined" && process.versions?.node) {
      const zlib = await import("zlib")
      return {
        contentEncoding: "gzip",
        compress: (data) => new Uint8Array(zlib.gzipSync(data)),
        decompress: (data) => new Uint8Array(zlib.gunzipSync(data)),
      }
    } else {
      // Browser: try pako
      const pako = await import("pako")
      return {
        contentEncoding: "gzip",
        compress: (data) => pako.gzip(data),
        decompress: (data) => pako.ungzip(data),
      }
    }
  }

  private async loadLz4(): Promise<CompressionCodec | null> {
    try {
      // Using lz4-napi for native bindings
      const lz4 = await import("lz4-napi")
      return {
        contentEncoding: "lz4",
        compress: (data) => new Uint8Array(lz4.compressSync(Buffer.from(data))),
        decompress: (data) => new Uint8Array(lz4.uncompressSync(Buffer.from(data))),
      }
    } catch {
      return null
    }
  }

  private async loadSnappy(): Promise<CompressionCodec | null> {
    try {
      const snappy = await import("snappy")
      return {
        contentEncoding: "snappy",
        compress: (data) => new Uint8Array(snappy.compressSync(data)),
        decompress: (data) => new Uint8Array(snappy.uncompressSync(data)),
      }
    } catch {
      return null
    }
  }

  private async loadZstd(): Promise<CompressionCodec | null> {
    // @mongodb-js/zstd only has async methods, not supported for sync compression
    // TODO: Consider using a different zstd library with sync support
    return null
  }
}

// Singleton instance
export const compressionRegistry = new CompressionRegistry()
