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
      this.channel.queueUnbind(this.name, exchange, routingkey, args)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Publish a message directly to the queue
   * @param {String|Uint8array} body - the data to be published, can be a string or an uint8array
   * @param {object} properties - publish properties
   * @param {string} properties.contentType - mime type, eg. application/json
   * @param {string} properties.contentEncoding - eg. gzip
   * @param {object} properties.headers - custom headers, can also be used for routing with header exchanges
   * @param {number} properties.deliveryMode - 1 for transient, 2 for persisent
   * @param {number} properties.priority - between 0 and 255
   * @param {string} properties.correlationId - for RPC requests
   * @param {string} properties.replyTo - for RPC requests
   * @param {string} properties.expiration - number in milliseconds, as string
   * @param {string} properties.messageId
   * @param {Date} properties.timestamp - the time the message was generated
   * @param {string} properties.type
   * @param {string} properties.userId
   * @param {string} properties.appId
   * @return {Promise<number, AMQPError>} - fulfilled when the message is enqueue on the socket, or if publish confirm is enabled when the message is confirmed by the server
   */
  publish(body, properties) {
    return new Promise((resolve, reject) => {
      this.channel.basicPublish("", this.name, body, properties)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Subscribe to the queue
   * @param {object} params
   * @param {boolean} params.noAck - automatically acknowledge messages when received
   * @param {boolean} params.exclusive - be the exclusive consumer of the queue
   * @param {function(AMQPMessage)} callback - Function to be called for each received message
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
