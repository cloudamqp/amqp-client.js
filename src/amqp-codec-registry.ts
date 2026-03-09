import type { AMQPProperties } from "./amqp-properties.js"

/** Handles serialization/deserialization based on content-type. */
export interface AMQPParser {
  serialize(body: unknown, properties: AMQPProperties): Uint8Array
  parse(body: Uint8Array, properties: AMQPProperties): unknown
}

/** Handles compression/decompression based on content-encoding. */
export interface AMQPCoder {
  encode(body: Uint8Array, properties: AMQPProperties): Promise<Uint8Array>
  decode(body: Uint8Array, properties: AMQPProperties): Promise<Uint8Array>
}

function toBytes(data: string | Uint8Array | ArrayBuffer | Buffer | null): Uint8Array {
  if (data === null || data === undefined) return new Uint8Array(0)
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof data === "string") return new TextEncoder().encode(data)
  return new Uint8Array(data)
}

const PlainParser: AMQPParser = {
  serialize(body: unknown): Uint8Array {
    const str = typeof body === "string" ? body : String(body)
    return new TextEncoder().encode(str)
  },
  parse(body: Uint8Array): string {
    return new TextDecoder().decode(body)
  },
}

const JSONParser: AMQPParser = {
  serialize(body: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(body))
  },
  parse(body: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(body))
  },
}

async function compressWithStream(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream(format))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decompressWithStream(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(format))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const GzipCoder: AMQPCoder = {
  encode(body: Uint8Array): Promise<Uint8Array> {
    return compressWithStream(body, "gzip")
  },
  decode(body: Uint8Array): Promise<Uint8Array> {
    return decompressWithStream(body, "gzip")
  },
}

const DeflateCoder: AMQPCoder = {
  encode(body: Uint8Array): Promise<Uint8Array> {
    return compressWithStream(body, "deflate")
  },
  decode(body: Uint8Array): Promise<Uint8Array> {
    return decompressWithStream(body, "deflate")
  },
}

/**
 * Registry for message parsers (content-type) and coders (content-encoding).
 *
 * Built-in parsers: `text/plain`, `application/json`.
 * Built-in coders: `gzip`, `deflate`.
 *
 * @example
 * ```ts
 * const codecs = new AMQPCodecRegistry()
 * codecs.enableBuiltinCodecs()
 * const session = await AMQPSession.connect(url, {
 *   codecs,
 *   defaultContentType: "application/json",
 * })
 * ```
 */
export class AMQPCodecRegistry {
  private readonly parsers = new Map<string, AMQPParser>()
  private readonly coders = new Map<string, AMQPCoder>()

  registerParser(contentType: string, parser: AMQPParser): this {
    this.parsers.set(contentType, parser)
    return this
  }

  registerCoder(contentEncoding: string, coder: AMQPCoder): this {
    this.coders.set(contentEncoding, coder)
    return this
  }

  findParser(contentType: string): AMQPParser | undefined {
    return this.parsers.get(contentType)
  }

  findCoder(contentEncoding: string): AMQPCoder | undefined {
    return this.coders.get(contentEncoding)
  }

  enableBuiltinParsers(): this {
    this.parsers.set("text/plain", PlainParser)
    this.parsers.set("application/json", JSONParser)
    return this
  }

  enableBuiltinCoders(): this {
    if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") {
      throw new Error(
        "Built-in coders require CompressionStream/DecompressionStream (Node 18+, modern browsers). " +
          "Register custom coders via registerCoder() instead.",
      )
    }
    this.coders.set("gzip", GzipCoder)
    this.coders.set("deflate", DeflateCoder)
    return this
  }

  enableBuiltinCodecs(): this {
    this.enableBuiltinParsers()
    this.enableBuiltinCoders()
    return this
  }

  /**
   * Serialize and encode a body for publishing.
   * Returns the transformed body and updated properties.
   */
  async serializeAndEncode(
    body: unknown,
    properties: AMQPProperties,
    defaults?: { contentType?: string; contentEncoding?: string },
  ): Promise<{ body: Uint8Array; properties: AMQPProperties }> {
    const props = { ...properties }
    if (defaults?.contentType && !props.contentType) props.contentType = defaults.contentType
    if (defaults?.contentEncoding && !props.contentEncoding) props.contentEncoding = defaults.contentEncoding

    let bytes: Uint8Array
    if (props.contentType) {
      const parser = this.parsers.get(props.contentType)
      if (parser) {
        bytes = parser.serialize(body, props)
      } else {
        bytes = toBytes(body as string | Uint8Array | ArrayBuffer | Buffer | null)
      }
    } else {
      bytes = toBytes(body as string | Uint8Array | ArrayBuffer | Buffer | null)
    }

    if (props.contentEncoding) {
      const coder = this.coders.get(props.contentEncoding)
      if (coder) {
        bytes = await coder.encode(bytes, props)
      }
    }

    return { body: bytes, properties: props }
  }

  /**
   * Decode and parse a message body.
   * Reverses the encoding pipeline: decompress then deserialize.
   */
  async decodeAndParse(body: Uint8Array, properties: AMQPProperties): Promise<unknown> {
    let bytes = body

    if (properties.contentEncoding) {
      const coder = this.coders.get(properties.contentEncoding)
      if (coder) {
        bytes = await coder.decode(bytes, properties)
      }
    }

    if (properties.contentType) {
      const parser = this.parsers.get(properties.contentType)
      if (parser) {
        return parser.parse(bytes, properties)
      }
    }

    return bytes
  }
}
