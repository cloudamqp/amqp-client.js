import type { AMQPChannel } from "./amqp-channel.js"
import type { AMQPProperties } from "./amqp-properties.js"
import { compressionRegistry, CompressionError } from "./amqp-compression.js"

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

  /** Cached decompressed body */
  private decompressedBody: Uint8Array | null = null

  /**
   * @param channel - Channel this message was delivered on
   */
  constructor(channel: AMQPChannel) {
    this.channel = channel
  }

  /** Known compression encodings */
  private static readonly COMPRESSION_ENCODINGS: readonly string[] = ["gzip", "lz4", "snappy", "zstd"]

  /**
   * Get the decompressed body if contentEncoding indicates compression,
   * otherwise returns the raw body.
   * @throws CompressionError if the required codec is not available/loaded
   */
  bodyDecompressed(): Uint8Array | null {
    if (!this.body) return null

    // Return cached if available
    if (this.decompressedBody) return this.decompressedBody

    const encoding = this.properties.contentEncoding
    if (!encoding) return this.body

    // Check if this is a known compression encoding
    if (!AMQPMessage.COMPRESSION_ENCODINGS.includes(encoding)) {
      // Unknown encoding, return raw body
      return this.body
    }

    const codec = compressionRegistry.getCodecSync(encoding)
    if (!codec) {
      throw new CompressionError(
        `Cannot decompress message: codec '${encoding}' is not loaded. Ensure the codec was used for compression first.`,
        encoding as "gzip" | "lz4" | "snappy" | "zstd",
      )
    }

    this.decompressedBody = codec.decompress(this.body)
    return this.decompressedBody
  }

  /**
   * Converts the message (which is delivered as an uint8array) to a string,
   * auto-decompressing if the contentEncoding indicates compression.
   */
  bodyToString(): string | null {
    const body = this.bodyDecompressed()
    if (!body) return null

    if (typeof Buffer !== "undefined") {
      return Buffer.from(body).toString()
    } else {
      return new TextDecoder().decode(body)
    }
  }

  bodyString(): string | null {
    return this.bodyToString()
  }

  /** Acknowledge the message */
  ack(multiple = false) {
    return this.channel.basicAck(this.deliveryTag, multiple)
  }

  /** Negative acknowledgment (same as reject) */
  nack(requeue = false, multiple = false) {
    return this.channel.basicNack(this.deliveryTag, requeue, multiple)
  }

  /** Rejected the message */
  reject(requeue = false) {
    return this.channel.basicReject(this.deliveryTag, requeue)
  }

  /** Cancel the consumer the message arrived to **/
  cancelConsumer() {
    return this.channel.basicCancel(this.consumerTag)
  }
}
