export default class AMQPMessage {
  constructor(channel) {
    this.channel = channel
  }

  bodyString() {
    const decoder = new TextDecoder()
    return decoder.decode(this.body)
  }

  ack() {
    return this.channel.basicAck(this.deliveryTag)
  }

  nack() {
    return this.channel.basicNack(this.deliveryTag)
  }
}
