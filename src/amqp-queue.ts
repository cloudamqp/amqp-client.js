import AMQPChannel from "./amqp-channel.js"
import AMQPConsumer from "./amqp-consumer.js"
import AMQPMessage from "./amqp-message.js"
import AMQPProperties from "./protocol/amqp-properties.js"

/**
 * Convience class for queues
 *
 * @param channel - channel this queue was declared on
 * @param name - name of the queue
 * @property {AMQPChannel} channel
 * @property {string} name
 */
export class AMQPQueue {
  readonly channel: AMQPChannel
  readonly name: string
  constructor(channel: AMQPChannel, name: string) {
    this.channel = channel
    this.name = name
  }

  /**
   * Bind the queue to an exchange
   */
  bind(exchange: string, routingkey?: string, args?: Record<string, unknown>): Promise<AMQPQueue> {
    return new Promise((resolve, reject) => {
      this.channel.queueBind(this.name, exchange, routingkey, args)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Delete a binding between this queue and an exchange
   */
  unbind(exchange: string, routingkey: string, args: Record<string, unknown> = {}): Promise<AMQPQueue> {
    return new Promise((resolve, reject) => {
      this.channel.queueUnbind(this.name, exchange, routingkey, args)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Publish a message directly to the queue
   * @param body - the data to be published, can be a string or an uint8array
   * @param properties - publish properties
   * @return - fulfilled when the message is enqueue on the socket, or if publish confirm is enabled when the message is confirmed by the server
   */
  publish(body: string|Uint8Array, properties?: AMQPProperties): Promise<AMQPQueue> {
    return new Promise((resolve, reject) => {
      this.channel.basicPublish("", this.name, body, properties)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Subscribe to the queue
   * @param params
   * @param {boolean} params.noAck - automatically acknowledge messages when received
   * @param {boolean} params.exclusive - be the exclusive consumer of the queue
   * @param callback - Function to be called for each received message
   * @return
   */
  subscribe({noAck = true, exclusive = false} = {}, callback: (msg: AMQPMessage) => any): Promise<AMQPConsumer> {
    return this.channel.basicConsume(this.name, {noAck, exclusive}, callback)
  }

  /**
   * Unsubscribe from the queue
   * @param consumerTag - The consumer that wants to unsubscribe
   * @return
   */
  unsubscribe(consumerTag: string): Promise<AMQPQueue> {
    return new Promise((resolve, reject) => {
      this.channel.basicCancel(consumerTag)
        .then(() => resolve(this))
        .catch(reject)
    })
  }
  /**
   * Delete this queue
   * @return
   */
  delete(): Promise<AMQPQueue> {
    return new Promise((resolve, reject) => {
      this.channel.queueDelete(this.name)
        .then(() => resolve(this))
        .catch(reject)
    })
  }
  /**
   * Get's a message from the queue
   * @param params
   * @param {boolean} params.noAck - automatically acknowledge messages when received
   * @return
   */
  get({ noAck = true}: {noAck: boolean}): Promise<AMQPMessage> {
    return this.channel.basicGet(this.name, { noAck })
  }
}

export default AMQPQueue
