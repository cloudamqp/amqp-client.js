export default class AMQPConsumer {
  constructor(channel, tag) {
    this.channel = channel
    this.tag = tag
  }

  cancel() {
    return this.channel.basicCancel(this.tag)
  }
}
