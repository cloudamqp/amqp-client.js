export default class AMQPQueue {
  constructor(channel, name) {
    this.channel = channel
    this.name = name
  }

  bind(exchange, routingkey, args = {}) {
    return new Promise((resolve, reject) => {
      this.channel.queueBind(this.name, exchange, routingkey, args)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  unbind(exchange, routingkey, args = {}) {
    return new Promise((resolve, reject) => {
      this.channel.queueUnind(this.name, exchange, routingkey, args)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  publish(body, properties) {
    return new Promise((resolve, reject) => {
      this.channel.basicPublish("", this.name, body, properties)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  subscribe({noAck = true, exclusive = false} = {}, callback) {
    return new Promise((resolve, reject) => {
      this.channel.basicConsume(this.name, {noAck, exclusive}, callback)
        .then(resolve)
        .catch(reject)
    })
  }

  unsubscribe(consumerTag) {
    return new Promise((resolve, reject) => {
      this.channel.basicCancel(consumerTag)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  delete() {
    return new Promise((resolve, reject) => {
      this.channel.queueDelete(this.name)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  get({ noAck = true}) {
    return this.channel.basicGet(this.name, { noAck })
  }
}
