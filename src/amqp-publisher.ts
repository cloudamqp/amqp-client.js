import type { ParserMap, InferParserInput } from "./amqp-codec-registry.js"
import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"

/** Controls whether session methods accept rich types or only raw bytes. */
export type CodecMode = "plain" | "codec"

export type PlainBody = string | Uint8Array | ArrayBuffer | Buffer | null
type Serializable = PlainBody | number | boolean | Record<string, unknown> | unknown[]

export function isPlainBody(data: unknown): data is PlainBody {
  return data === null || typeof data === "string" || data instanceof Uint8Array || data instanceof ArrayBuffer
}

export type Body<C extends CodecMode> = C extends "codec" ? Serializable : PlainBody

/**
 * Resolve the publish body type from the effective content-type key `O`.
 *
 * `O` defaults to `K` (the session's `defaultContentType`) at the call site,
 * so the cascade is: explicit contentType → default contentType → PlainBody.
 */
export type ResolveBody<T extends ParserMap, O extends keyof T & string> =
  [O] extends [never] ? PlainBody : InferParserInput<T[O]>

/** Publish with broker confirmation. */
export async function publishConfirmed<C extends CodecMode, T extends ParserMap, K extends keyof T & string = keyof T & string>(
  session: AMQPSession<C, T, K>,
  exchange: string,
  routingKey: string,
  body: Body<C>,
  properties?: AMQPProperties,
): Promise<void> {
  const encoded = await session.encodeBody(body, properties ?? {})
  const ch = await session.getConfirmChannel()
  await ch.basicPublish(exchange, routingKey, encoded.body, encoded.properties)
}

/** Publish without waiting for broker confirmation. */
export async function publishNoConfirm<C extends CodecMode, T extends ParserMap>(
  session: AMQPSession<C, T>,
  exchange: string,
  routingKey: string,
  body: Body<C>,
  properties?: AMQPProperties,
): Promise<void> {
  const encoded = await session.encodeBody(body, properties ?? {})
  const ch = await session.getOpsChannel()
  await ch.basicPublish(exchange, routingKey, encoded.body, encoded.properties)
}
