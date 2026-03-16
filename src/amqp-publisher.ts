import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"
import type { CodecMode } from "./amqp-message.js"

export type Body = string | Uint8Array | ArrayBuffer | Buffer | null

export function isBody(data: unknown): data is Body {
  return data === null || typeof data === "string" || data instanceof Uint8Array || data instanceof ArrayBuffer
}
export type Serializable = Body | number | boolean | Record<string, unknown> | unknown[]

export type PublishBody<C extends CodecMode> = C extends "codec" ? Serializable : Body

/** Publish with broker confirmation. */
export async function publishConfirmed<C extends CodecMode>(
  session: AMQPSession<C>,
  exchange: string,
  routingKey: string,
  body: PublishBody<C>,
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
  body: PublishBody<C>,
  properties?: AMQPProperties,
): Promise<void> {
  const encoded = await session.encodeBody(body, properties ?? {})
  const ch = await session.getOpsChannel()
  await ch.basicPublish(exchange, routingKey, encoded.body, encoded.properties)
}
