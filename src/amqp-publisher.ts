import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"

export type Body = string | Uint8Array | ArrayBuffer | Buffer | null

/** Publish with broker confirmation. */
export async function publishConfirmed(
  session: AMQPSession,
  exchange: string,
  routingKey: string,
  body: Body,
  properties?: AMQPProperties,
): Promise<void> {
  const ch = await session.getConfirmChannel()
  await ch.basicPublish(exchange, routingKey, body, properties ?? {})
}

/** Publish without waiting for broker confirmation. */
export async function publishNoConfirm(
  session: AMQPSession,
  exchange: string,
  routingKey: string,
  body: Body,
  properties?: AMQPProperties,
): Promise<void> {
  const ch = await session.getOpsChannel()
  await ch.basicPublish(exchange, routingKey, body, properties ?? {})
}
