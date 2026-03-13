import type { AMQPChannel } from "./amqp-channel.js"
import type { AMQPCodecRegistry } from "./amqp-codec-registry.js"
import type { AMQPProperties } from "./amqp-properties.js"

/**
 * AMQP message
 * @property {AMQPChannel} channel - Channel this message was delivered on
 * @property {string} exchange - The exchange the message was published to
 * @property {string} routingKey - The routing key the message was published with
 * @property {object} properties - Message metadata
 * @property {number} bodySize - Byte size of the body
 * @property {Uint8Array} body - The raw message body
 * @property {number} deliveryTag - The deliveryTag of this message
 * @property {boolean} redelivered - The consumer tag, if deliveried to a consumer
 * @property {string?} consumerTag - The consumer tag, if deliveried to a consumer
 * @property {number?} messageCount - Number of messages left in queue (when polling)
 * @property {number} replyCode - Code if message was returned
 * @property {string} replyText - Error message on why message was returned
 */
export class AMQPMessage {
  channel: AMQPChannel
  exchange = ""
  routingKey = ""
  properties: AMQPProperties = {}
  bodySize = 0
  body: Uint8Array | null = null
  bodyPos = 0
  deliveryTag = 0
  consumerTag = ""
  redelivered = false
  messageCount?: number
  replyCode?: number
  replyText?: string
  /** @internal Set by the session layer for high-level codec support. */
  codecRegistry?: AMQPCodecRegistry
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

  /**
   * Converts the message (which is deliviered as an uint8array) to a string
   */
  bodyToString(): string | null {
    if (this.body) {
      if (typeof Buffer !== "undefined") return Buffer.from(this.body).toString()
      else return new TextDecoder().decode(this.body)
    } else {
      return null
    }
  }

  bodyString(): string | null {
    return this.bodyToString()
  }

  /**
   * Decode and deserialize the message body using the codec registry.
   *
   * Reverses the publish-side pipeline: decompresses based on
   * `contentEncoding`, then deserializes based on `contentType`.
   *
   * Requires a codec registry (set automatically when consuming via
   * a session with `codecs` configured, or pass one explicitly).
   *
   * @param registry - Optional codec registry override
   * @returns The decoded/deserialized body
   */
  async parse(registry?: AMQPCodecRegistry): Promise<unknown> {
    const codecs = registry ?? this.codecRegistry
    if (!codecs)
      throw new Error("No codec registry available. Configure codecs on the session or pass a registry to parse().")
    if (!this.body) return null
    return codecs.decodeAndParse(this.body, this.properties)
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
