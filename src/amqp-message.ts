import type { AMQPChannel } from "./amqp-channel.js"
import type { AMQPProperties } from "./amqp-properties.js"

/** Controls whether session methods accept rich types or only raw bytes. */
export type CodecMode = "plain" | "codec"

/**
 * AMQP message.
 *
 * `rawBody` always contains the original wire bytes.
 * `body` returns the decoded value when codecs are configured on the session,
 * or the raw `Uint8Array` otherwise.
 */
export class AMQPMessage {
  /** Channel this message was delivered on. */
  channel: AMQPChannel
  /** Exchange the message was published to. */
  exchange = ""
  /** Routing key the message was published with. */
  routingKey = ""
  /** Message metadata (content-type, headers, etc.). */
  properties: AMQPProperties = {}
  /** Byte size of the body. */
  bodySize = 0
  /** @internal Raw wire bytes. Use `body` instead. */
  rawBody: Uint8Array | null = null
  /** @internal */
  bodyPos = 0
  /** Server-assigned delivery tag for ack/nack/reject. */
  deliveryTag = 0
  /** Consumer tag, if delivered to a consumer. */
  consumerTag = ""
  /** Whether the message has been redelivered by the server. */
  redelivered = false
  /** Number of messages remaining in the queue (only set by basicGet). */
  messageCount?: number
  /** Reply code if the message was returned. */
  replyCode?: number
  /** Reason the message was returned. */
  replyText?: string
  private _body: unknown = undefined
  private _decoded = false
  private acked = false

  /**
   * The message body.
   *
   * Returns the decoded value if codecs processed the message,
   * or the raw `Uint8Array | null` wire bytes otherwise.
   */
  get body(): unknown {
    if (this._decoded) return this._body
    return this.rawBody
  }

  /** True if the message has already been acked, nacked, or rejected. */
  get isAcked(): boolean {
    return this.acked
  }

  /**
   * @param channel - Channel this message was delivered on
   */
  constructor(channel: AMQPChannel) {
    this.channel = channel
  }

  /**
   * @internal Set the decoded body. Used by the session layer after
   * deserializing + decompressing the raw bytes.
   */
  setDecodedBody(value: unknown): void {
    this._body = value
    this._decoded = true
  }

  /** Converts the raw message body to a string. */
  bodyToString(): string | null {
    if (this.rawBody) {
      if (typeof Buffer !== "undefined") return Buffer.from(this.rawBody).toString()
      else return new TextDecoder().decode(this.rawBody)
    } else {
      return null
    }
  }

  bodyString(): string | null {
    return this.bodyToString()
  }

  /** Acknowledge the message */
  ack(multiple = false) {
    if (this.acked) return Promise.resolve()
    this.acked = true
    return this.channel.basicAck(this.deliveryTag, multiple)
  }

  /** Negative acknowledgment (same as reject) */
  nack(requeue = false, multiple = false) {
    if (this.acked) return Promise.resolve()
    this.acked = true
    return this.channel.basicNack(this.deliveryTag, requeue, multiple)
  }

  /** Reject the message */
  reject(requeue = false) {
    if (this.acked) return Promise.resolve()
    this.acked = true
    return this.channel.basicReject(this.deliveryTag, requeue)
  }

  /** Cancel the consumer the message arrived to **/
  cancelConsumer() {
    return this.channel.basicCancel(this.consumerTag)
  }
}
