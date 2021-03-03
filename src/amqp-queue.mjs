/**
 * Convience class for queues
 */
export default class AMQPQueue {
  /**
   * @param {AMQPChannel} channel - channel this queue was declared on
   * @param {string} name - name of the queue
   */
  constructor(channel, name) {
    this.channel = channel
    this.name = name
  }

  /**
   * Bind the queue to an exchange
   */
  bind(exchange, routingkey, args = {}) {
    return new Promise((resolve, reject) => {
      this.channel.queueBind(this.name, exchange, routingkey, args)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Delete a binding between this queue and an exchange
   */
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

  /**
   * @return {Promise<AMQPConsumer, AMQPError>}
   */
  subscribe({noAck = true, exclusive = false} = {}, callback) {
    return this.channel.basicConsume(this.name, {noAck, exclusive}, callback)
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
