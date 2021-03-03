export default class AMQPMessage {
  /**
   * @param {AMQPChannel} channel - channel this message was delivered on
   */
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

  /**
   * @deprecated
   * @return {string}
   */
  bodyString() {
    return this.bodyToString()
  }

  /** Acknowledge the message */
  ack(multiple = false) {
    return this.channel.basicAck(this.deliveryTag, multiple)
  }

  /** Rejected the message */
  reject(requeue = false) {
    return this.channel.basicReject(this.deliveryTag, requeue)
  }

  /** Negative acknowledgment (same as reject) */
  nack(requeue = false, multiple = false) {
    return this.channel.basicNack(this.deliveryTag, requeue, multiple)
  }
}
