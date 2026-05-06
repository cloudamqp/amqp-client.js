import type { ParserMap, InferParserInput, InferParserOutput } from "./amqp-codec-registry.js"

export type PlainBody = string | Uint8Array | ArrayBuffer | Buffer | null

export function isPlainBody(data: unknown): data is PlainBody {
  return data === null || typeof data === "string" || data instanceof Uint8Array || data instanceof ArrayBuffer
}

/**
 * Resolve the publish body type from the effective content-type key `O`.
 * Cascade: explicit contentType → default contentType → PlainBody.
 */
export type ResolveBody<P extends ParserMap, O extends keyof P & string> = [O] extends [never]
  ? PlainBody
  : InferParserInput<P[O]>

/**
 * Resolve the message body type for consuming.
 * Union of all parser output types + Uint8Array | null (for unrecognized content-types).
 */
export type ResolveMessageBody<P extends ParserMap> = keyof P extends never
  ? Uint8Array | null
  : InferParserOutput<P[keyof P & string]> | Uint8Array | null
