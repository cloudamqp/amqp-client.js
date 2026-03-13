import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"

export type Body = string | Uint8Array | ArrayBuffer | Buffer | null
export type Serializable = Body | number | boolean | Record<string, unknown> | unknown[]
export type PublishBody<C extends boolean> = C extends true ? Serializable : Body

/** Publish with broker confirmation. */
export async function publishConfirmed(
  session: AMQPSession<boolean>,
  exchange: string,
  routingKey: string,
  body: unknown,
  properties?: AMQPProperties,
): Promise<void> {
  const encoded = await session.encodeBody(body, properties ?? {})
  const ch = await session.getConfirmChannel()
  await ch.basicPublish(exchange, routingKey, encoded.body, encoded.properties)
}

/** Publish without waiting for broker confirmation. */
export async function publishNoConfirm(
  session: AMQPSession<boolean>,
  exchange: string,
  routingKey: string,
  body: unknown,
  properties?: AMQPProperties,
): Promise<void> {
  const encoded = await session.encodeBody(body, properties ?? {})
  const ch = await session.getOpsChannel()
  await ch.basicPublish(exchange, routingKey, encoded.body, encoded.properties)
}
