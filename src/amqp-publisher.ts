import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"

export type Body = string | Uint8Array | ArrayBuffer | Buffer | null

export function isBody(data: unknown): data is Body {
  return (
    data === null ||
    typeof data === "string" ||
    data instanceof Uint8Array ||
    data instanceof ArrayBuffer
  )
}
export type Serializable = Body | number | boolean | Record<string, unknown> | unknown[]

/** Controls whether publish methods accept rich types or only raw bytes. */
export type CodecMode = "plain" | "codec"
export type PublishBody<C extends CodecMode> = C extends "codec" ? Serializable : Body

/** Publish with broker confirmation. */
export async function publishConfirmed(
  session: AMQPSession<CodecMode>,
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
  session: AMQPSession<CodecMode>,
  exchange: string,
  routingKey: string,
  body: unknown,
  properties?: AMQPProperties,
): Promise<void> {
  const encoded = await session.encodeBody(body, properties ?? {})
  const ch = await session.getOpsChannel()
  await ch.basicPublish(exchange, routingKey, encoded.body, encoded.properties)
}
