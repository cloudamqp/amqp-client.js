import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"
import type { CodecMode } from "./amqp-message.js"

export type WireBody = string | Uint8Array | ArrayBuffer | Buffer | null
export type Body = WireBody | number | boolean | Record<string, unknown> | unknown[]

export function isWireBody(data: unknown): data is WireBody {
  return data === null || typeof data === "string" || data instanceof Uint8Array || data instanceof ArrayBuffer
}

export type PublishBody<C extends CodecMode> = C extends "codec" ? Body : WireBody

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
