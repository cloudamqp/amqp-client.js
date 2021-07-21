/**
 * AMQP message
 * @param {AMQPChannel} channel - Channel this message was delivered on
 * @property {Uint8array} body - The raw message body
 * @property {Uint8array} deliveryTag - The deliveryTag of this message
 */
export default class AMQPMessage {
  constructor(channel) {
    this.channel = channel
  }

  /**
   * Converts the message (which is deliviered as an uint8array) to a string
   * @return {string} utf8 encoded string
   */
  bodyToString() {
    const decoder = new TextDecoder()
    return decoder.decode(this.body)
  }

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
