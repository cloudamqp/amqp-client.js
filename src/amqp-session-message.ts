import type { AMQPChannel } from "./amqp-channel.js"
import type { AMQPCodecRegistry } from "./amqp-codec-registry.js"
import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPProperties } from "./amqp-properties.js"

/**
 * High-level message wrapper returned by session-layer consume and get operations.
 *
 * The `body` is automatically decoded (deserialized + decompressed) when a
 * codec registry is configured on the session. Without codecs, `body` is
 * the raw `Uint8Array` (same as `rawBody`).
 */
export class SessionMessage {
  readonly body: unknown
  readonly raw: AMQPMessage

  constructor(body: unknown, raw: AMQPMessage) {
    this.body = body
    this.raw = raw
  }

  get rawBody(): Uint8Array | null {
    return this.raw.body
  }

  get properties(): AMQPProperties {
    return this.raw.properties
  }

  get exchange(): string {
    return this.raw.exchange
  }

  get routingKey(): string {
    return this.raw.routingKey
  }

  get deliveryTag(): number {
    return this.raw.deliveryTag
  }

  get consumerTag(): string {
    return this.raw.consumerTag
  }

  get redelivered(): boolean {
    return this.raw.redelivered
  }

  get channel(): AMQPChannel {
    return this.raw.channel
  }

  get isAcked(): boolean {
    return this.raw.isAcked
  }

  ack(multiple = false) {
    return this.raw.ack(multiple)
  }

  nack(requeue = false, multiple = false) {
    return this.raw.nack(requeue, multiple)
  }

  reject(requeue = false) {
    return this.raw.reject(requeue)
  }

  bodyToString(): string | null {
    return this.raw.bodyToString()
  }

  bodyString(): string | null {
    return this.raw.bodyToString()
  }
}

export async function decodeMessage(
  msg: AMQPMessage,
  codecs?: AMQPCodecRegistry,
): Promise<SessionMessage> {
  let body: unknown
  if (codecs && msg.body) {
    body = await codecs.decodeAndParse(msg.body, msg.properties)
  } else {
    body = msg.body
  }
  return new SessionMessage(body, msg)
}
