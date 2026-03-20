import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPProperties } from "./amqp-properties.js"
import { isPlainBody } from "./amqp-publisher.js"

// 1. Define a type that represents a map of different Parsers
export type ParserMap = {
  [K: string]: AMQPParser<any, any>
}

// 2. The ParserRegistry type uses a Mapped Type to preserve the unique In/Out of each key
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

type BuiltinParsers = {
  "text/plain": AMQPParser<string, string>
  "application/json": AMQPParser<JsonSerializable, unknown>
}

// 3. The factory function
export function createParserRegistry<T extends ParserMap>(parsers: T, useDefaultParsers?: false): ParserRegistry<T>
export function createParserRegistry<T extends ParserMap>(
  parsers: T,
  useDefaultParsers: true,
): ParserRegistry<T & BuiltinParsers>
export function createParserRegistry<T extends ParserMap>(
  parsers: T,
  useDefaultParsers?: boolean,
): ParserRegistry<T & BuiltinParsers> | ParserRegistry<T> {
  if (useDefaultParsers) {
    return { "text/plain": PlainParser, "application/json": JSONParser, ...parsers }
  }
  return parsers
}

export type InferParserInput<P> = P extends AMQPParser<infer TInput, any> ? TInput : never
export type InferParserOutput<P> = P extends AMQPParser<any, infer Out> ? Out : never

export type CoderMap = { [K: string]: AMQPCoder }
export type CoderRegistry<T extends CoderMap> = { readonly [K in keyof T & string]: T[K] }

type BuiltinCoders = { gzip: AMQPCoder; deflate: AMQPCoder }

export function createCoderRegistry<T extends CoderMap>(coders: T, useDefaults?: false): CoderRegistry<T>
export function createCoderRegistry<T extends CoderMap>(coders: T, useDefaults: true): CoderRegistry<T & BuiltinCoders>
export function createCoderRegistry<T extends CoderMap>(
  coders: T,
  useDefaults?: boolean,
): CoderRegistry<T & BuiltinCoders> | CoderRegistry<T> {
  if (useDefaults) {
    if (
      typeof CompressionStream === "undefined" ||
      typeof DecompressionStream === "undefined" ||
      typeof Blob === "undefined" ||
      typeof Response === "undefined"
    ) {
      throw new Error(
        "Built-in coders require CompressionStream, DecompressionStream, Blob, and Response " +
          "(Node 18+, modern browsers). Register custom coders via createCoderRegistry() instead.",
      )
    }
    return { gzip: GzipCoder, deflate: DeflateCoder, ...coders }
  }
  return coders
}

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

