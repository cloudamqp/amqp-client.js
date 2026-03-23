import type { AMQPChannel } from "./amqp-channel.js"
import type { AMQPProperties } from "./amqp-properties.js"
import type { ParserMap } from "./amqp-codec-registry.js"
import type { ResolveMessageBody } from "./amqp-publisher.js"

/**
 * AMQP message.
 *
 * The generic parameter `P` is the parser map type. When no parsers are
 * configured (`P = {}`), `body` is `Uint8Array | null` (raw wire bytes).
 * When parsers are configured, `body` is the union of all parser output
 * types plus `Uint8Array | null`.
 */
export class AMQPMessage<P extends ParserMap = {}> {
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
  /** @internal Raw bytes buffer used by the frame parser. */
  _rawBytes: Uint8Array | null = null
  /** @internal */
  bodyPos = 0
  /** Message body. Raw `Uint8Array` bytes in plain mode; decoded value in codec mode. */
  body: ResolveMessageBody<P> = null as ResolveMessageBody<P>
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
  private acked = false

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

  /** Converts the raw message body to a string. */
  bodyToString(): string | null {
    if (this._rawBytes) {
      if (typeof Buffer !== "undefined") return Buffer.from(this._rawBytes).toString()
      else return new TextDecoder().decode(this._rawBytes)
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
