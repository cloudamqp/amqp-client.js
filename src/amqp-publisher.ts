import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"

export type Body = string | Uint8Array | ArrayBuffer | Buffer | null

async function encodeBody(
  session: AMQPSession,
  body: Body | unknown,
  properties: AMQPProperties,
): Promise<{ body: Body; properties: AMQPProperties }> {
  if (!session.codecs) return { body: body as Body, properties }
  const defaults: { contentType?: string; contentEncoding?: string } = {}
  if (session.defaultContentType) defaults.contentType = session.defaultContentType
  if (session.defaultContentEncoding) defaults.contentEncoding = session.defaultContentEncoding
  const result = await session.codecs.serializeAndEncode(body, properties, defaults)
  return { body: result.body, properties: result.properties }
}

/** Publish with broker confirmation. */
export async function publishConfirmed(
  session: AMQPSession,
  exchange: string,
  routingKey: string,
  body: Body | unknown,
  properties?: AMQPProperties,
): Promise<void> {
  const encoded = await encodeBody(session, body, properties ?? {})
  const ch = await session.getConfirmChannel()
  await ch.basicPublish(exchange, routingKey, encoded.body as Body, encoded.properties)
}

/** Publish without waiting for broker confirmation. */
export async function publishNoConfirm(
  session: AMQPSession,
  exchange: string,
  routingKey: string,
  body: Body | unknown,
  properties?: AMQPProperties,
): Promise<void> {
  const encoded = await encodeBody(session, body, properties ?? {})
  const ch = await session.getOpsChannel()
  await ch.basicPublish(exchange, routingKey, encoded.body as Body, encoded.properties)
}
