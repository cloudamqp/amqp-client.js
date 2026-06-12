import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPProperties } from "./amqp-properties.js"
import { isPlainBody } from "./amqp-publisher.js"

/** Map of content-type → parser. */
export type ParserMap = {
  [K: string]: AMQPParser<unknown, unknown>
}

/** Readonly view of a {@link ParserMap}; returned by helpers. */
export type ParserRegistry<T extends ParserMap> = {
  readonly [K in keyof T & string]: T[K]
}

export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable }

/** Shape of {@link builtinParsers}: `text/plain` and `application/json`. */
export type BuiltinParsers = {
  "text/plain": AMQPParser<string, string>
  "application/json": AMQPParser<JsonSerializable, unknown>
}

export type InferParserInput<P> = P extends AMQPParser<infer TInput, unknown> ? TInput : never
export type InferParserOutput<P> = P extends AMQPParser<never, infer Out> ? Out : never

/** Map of content-encoding → coder. */
export type CoderMap = { [K: string]: AMQPCoder }
/** Readonly view of a {@link CoderMap}. */
export type CoderRegistry<T extends CoderMap> = { readonly [K in keyof T & string]: T[K] }

/** Shape of {@link builtinCoders}: `gzip` and `deflate`. */
export type BuiltinCoders = { gzip: AMQPCoder; deflate: AMQPCoder }

/** Handles serialization/deserialization based on content-type. */
export interface AMQPParser<In = unknown, Out = unknown> {
  serialize(body: In, properties: AMQPProperties): Uint8Array
  parse(body: Uint8Array, properties: AMQPProperties): Out
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

const PlainParser: AMQPParser<string, string> = {
  serialize(body: string): Uint8Array {
    return new TextEncoder().encode(String(body))
  },
  parse(body: Uint8Array): string {
    return new TextDecoder().decode(body)
  },
}

const JSONParser: AMQPParser<JsonSerializable, unknown> = {
  serialize(body: JsonSerializable): Uint8Array {
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
 * Raw DEFLATE coder (RFC 1951 — no zlib header, no Adler-32 checksum).
 * Not registered by default. Use to interoperate with producers that emit
 * raw DEFLATE under `content-encoding: deflate`, the same ambiguity HTTP
 * has carried for decades and that Node's `zlib.deflateRawSync` exists for.
 *
 * @example
 * ```ts
 * import { AMQPSession, builtinCoders, deflateRawCoder } from "@cloudamqp/amqp-client"
 *
 * const session = await AMQPSession.connect(url, {
 *   coders: { ...builtinCoders, deflate: deflateRawCoder },
 * })
 * ```
 */
export const deflateRawCoder: AMQPCoder = {
  encode(body: Uint8Array): Promise<Uint8Array> {
    return compressWithStream(body, "deflate-raw")
  },
  decode(body: Uint8Array): Promise<Uint8Array> {
    return decompressWithStream(body, "deflate-raw")
  },
}

/**
 * Built-in parsers for `text/plain` and `application/json`.
 * Use directly, or merge with custom parsers via spread:
 * `{ ...builtinParsers, "text/csv": csvParser }`.
 */
export const builtinParsers: ParserRegistry<BuiltinParsers> = {
  "text/plain": PlainParser,
  "application/json": JSONParser,
}

/**
 * Built-in coders for `gzip` and `deflate`.
 * Uses `CompressionStream`/`DecompressionStream` — requires Node 18+ or a modern browser.
 */
export const builtinCoders: CoderRegistry<BuiltinCoders> = {
  gzip: GzipCoder,
  deflate: DeflateCoder,
}

export function serializeAndEncode(
  parsers: ParserMap,
  coders: CoderMap,
  body: unknown,
  properties: AMQPProperties,
  defaults?: { contentType?: string; contentEncoding?: string },
): Promise<{ body: Uint8Array; properties: AMQPProperties }> | { body: Uint8Array; properties: AMQPProperties } {
  const props = { ...properties }
  if (defaults?.contentType && !props.contentType) props.contentType = defaults.contentType
  if (defaults?.contentEncoding && !props.contentEncoding) props.contentEncoding = defaults.contentEncoding

  let bytes: Uint8Array
  if (props.contentType) {
    const parser = parsers[props.contentType]
    if (parser) {
      bytes = parser.serialize(body, props)
    } else if (isPlainBody(body)) {
      bytes = toBytes(body)
    } else {
      throw new Error(
        `No parser registered for content-type "${props.contentType}" and body is not a string/Buffer/Uint8Array.`,
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
    const coder = coders[props.contentEncoding]
    if (!coder) {
      throw new Error(`No coder registered for content-encoding "${props.contentEncoding}".`)
    }
    return coder.encode(bytes, props).then((encoded: Uint8Array) => ({ body: encoded, properties: props }))
  }

  return { body: bytes, properties: props }
}

export function decodeAndParse(
  parsers: ParserMap,
  coders: CoderMap,
  body: Uint8Array,
  properties: AMQPProperties,
): Promise<unknown> | unknown {
  if (properties.contentEncoding) {
    const coder = coders[properties.contentEncoding]
    if (!coder) {
      throw new Error(`No coder registered for content-encoding "${properties.contentEncoding}".`)
    }
    return coder.decode(body, properties).then((decoded: Uint8Array) => {
      if (properties.contentType) {
        const parser = parsers[properties.contentType]
        if (parser) return parser.parse(decoded, properties)
      }
      return decoded
    })
  }

  if (properties.contentType) {
    const parser = parsers[properties.contentType]
    if (parser) return parser.parse(body, properties)
  }
  return body
}

export async function decodeMessage(msg: AMQPMessage, parsers: ParserMap, coders: CoderMap): Promise<void> {
  if (msg._rawBytes) {
    ;(msg as { body: unknown }).body = await decodeAndParse(parsers, coders, msg._rawBytes, msg.properties)
  }
}
