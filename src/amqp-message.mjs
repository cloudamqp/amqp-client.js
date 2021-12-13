import AMQPChannel from './amqp-channel.mjs'

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
export default class AMQPMessage {
  /**
   * @param {AMQPChannel} channel - Channel this message was delivered on
   */
  constructor(channel) {
    this.channel = channel
    this.exchange = ""
    this.routingKey = ""
    this.properties = {}
    this.bodySize = 0
    this.body = /** @type {Uint8Array|undefined} */ (undefined)
    this.bodyPos = 0
    this.deliveryTag = 0
    this.consumerTag = ""
    this.redelivered = false
    this.messageCount = undefined
    this.replyCode = 0
    this.replyText = ""
  }

  /**
   * Converts the message (which is deliviered as an uint8array) to a string
   * @return {string} utf8 encoded string
   */
  bodyToString() {
    const decoder = new TextDecoder()
    return decoder.decode(this.body)
  }

  /**
   * @return {string}
   */
  bodyString() {
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
