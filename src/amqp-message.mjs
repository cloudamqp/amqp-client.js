export default class AMQPMessage {
  constructor(channel) {
    this.channel = channel
  }

  bodyToString() {
    const decoder = new TextDecoder()
    return decoder.decode(this.body)
  }

  /** Alias for bodyToString()
  */
  bodyString() {
    return this.bodyToString()
  }

  ack(multiple = false) {
    return this.channel.basicAck(this.deliveryTag, multiple)
  }

  reject(requeue = false) {
    return this.channel.basicReject(this.deliveryTag, requeue)
  }

  nack(requeue = false, multiple = false) {
    return this.channel.basicNack(this.deliveryTag, requeue, multiple)
  }
}
