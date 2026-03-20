import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPProperties } from "./amqp-properties.js"
import { isPlainBody } from "./amqp-publisher.js"
interface Parser<In, Out> {
  serialize(body: In, properties: AMQPProperties): Uint8Array;
  parse(body: Uint8Array, properties: AMQPProperties): Out;
}

// 1. Define a type that represents a map of different Parsers
export type ParserMap = {
  [K: string]: Parser<any, any>;
};

// 2. The Registry type uses a Mapped Type to preserve the unique In/Out of each key
export type Registry<T extends ParserMap> = {
  readonly [K in keyof T & string]: T[K];
};

// 3. The factory function
export function createParserRegistry<T extends ParserMap>(parsers: T, useDefaultParsers?: false): Registry<T>
export function createParserRegistry<T extends ParserMap>(parsers: T, useDefaultParsers: true): Registry<T & { "text/plain": AMQPParser<string>, "application/json": AMQPParser }>
export function createParserRegistry<T extends ParserMap>(parsers: T, useDefaultParsers?: boolean): Registry<T & { "text/plain": AMQPParser<string>, "application/json": AMQPParser }> | Registry<T> {
  if (useDefaultParsers) {
    return { ...parsers, "text/plain": PlainParser, "application/json": JSONParser }
  }
  return parsers;
}

export type InferParserInput<P> = P extends Parser<infer TInput, any> ? TInput : never;

// const PlainParser: AMQPParser<string> = {
//   serialize(body: string): Uint8Array {
//     return new TextEncoder().encode(String(body))
//   },
//   parse(body: Uint8Array): string {
//     return new TextDecoder().decode(body)
//   },
// }


// const registry = createParserRegistry({
//   "csv": PlainParser,
// })

/** Handles serialization/deserialization based on content-type. */
export interface AMQPParser<T = unknown> {
  serialize(body: T, properties: AMQPProperties): Uint8Array
  parse(body: Uint8Array, properties: AMQPProperties): T
}

/** Handles compression/decompression based on content-encoding. */
export interface AMQPCoder {
  encode(body: Uint8Array, properties: AMQPProperties): Promise<Uint8Array>
  decode(body: Uint8Array, properties: AMQPProperties): Promise<Uint8Array>
}

function toBytes(data: string | Uint8Array | ArrayBuffer | Buffer | null): Uint8Array {
  if (data === null) return new Uint8Array(0)
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof data === "string") return new TextEncoder().encode(data)
  return new Uint8Array(data)
}

const PlainParser: AMQPParser<string> = {
  serialize(body: string): Uint8Array {
    return new TextEncoder().encode(String(body))
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

  registerParser<T>(contentType: string, parser: AMQPParser<T>): this {
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
    if (
      typeof CompressionStream === "undefined" ||
      typeof DecompressionStream === "undefined" ||
      typeof Blob === "undefined" ||
      typeof Response === "undefined"
    ) {
      throw new Error(
        "Built-in coders require CompressionStream, DecompressionStream, Blob, and Response " +
        "(Node 18+, modern browsers). Register custom coders via registerCoder() instead.",
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
      } else if (isPlainBody(body)) {
        bytes = toBytes(body)
      } else {
        throw new Error(
          `No parser registered for content-type "${props.contentType}" and body is not a string/Buffer/Uint8Array. ` +
          `Register a parser via registerParser() or use enableBuiltinParsers().`,
        )
      }
    } else if (isPlainBody(body)) {
      bytes = toBytes(body)
    } else {
      throw new Error(
        "Cannot serialize body: no contentType specified and body is not a string/Buffer/Uint8Array. " +
        "Set contentType or configure a defaultContentType on the session.",
      )
    }

    if (props.contentEncoding) {
      const coder = this.coders.get(props.contentEncoding)
      if (!coder) {
        throw new Error(
          `No coder registered for content-encoding "${props.contentEncoding}". ` +
          `Register a coder via registerCoder() or use enableBuiltinCoders().`,
        )
      }
      bytes = await coder.encode(bytes, props)
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
      if (!coder) {
        throw new Error(
          `No coder registered for content-encoding "${properties.contentEncoding}". ` +
          `Register a coder via registerCoder() or use enableBuiltinCoders().`,
        )
      }
      bytes = await coder.decode(bytes, properties)
    }

    if (properties.contentType) {
      const parser = this.parsers.get(properties.contentType)
      if (parser) {
        return parser.parse(bytes, properties)
      }
    }

    return bytes
  }

  /** Decode a message body, replacing the raw bytes on `msg.body`. */
  async decodeMessage(msg: AMQPMessage): Promise<void> {
    if (msg.rawBody) {
      // After decoding, body holds the parsed value (not raw bytes).
      // The caller is responsible for presenting the correct generic to consumers.
      ; (msg as { body: unknown }).body = await this.decodeAndParse(msg.rawBody, msg.properties)
    }
  }
}
