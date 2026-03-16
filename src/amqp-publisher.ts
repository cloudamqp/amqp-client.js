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

/** Publish with broker confirmation. */
export async function publishConfirmed<C extends CodecMode>(
  session: AMQPSession<C>,
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
export async function publishNoConfirm<C extends CodecMode>(
  session: AMQPSession<C>,
  exchange: string,
  routingKey: string,
  body: Body<C>,
  properties?: AMQPProperties,
): Promise<void> {
  const encoded = await session.encodeBody(body, properties ?? {})
  const ch = await session.getOpsChannel()
  await ch.basicPublish(exchange, routingKey, encoded.body, encoded.properties)
}
