import { AMQPMessage } from './amqp-message'
import { AMQPChannel } from './amqp-channel'
import { AMQPProperties } from './amqp-properties'

/**
 * Convience class for queues
 */
export class AMQPQueue {
  channel: AMQPChannel
  name: string
  /**
   * @param channel - channel this queue was declared on
   * @param name - name of the queue
   */
  constructor(channel: AMQPChannel, name: string) {
    this.channel = channel
    this.name = name
  }

  /**
   * Bind the queue to an exchange
   * @param exchange
   * @param routingkey
   * @param args - arguments
   * @return
   */
  bind(exchange: string, routingkey: string, args = {}) {
    const self = this
    return new Promise((resolve, reject) => {
      this.channel.queueBind(this.name, exchange, routingkey, args)
        .then(() => resolve(self))
        .catch(reject)
    })
  }

  /**
   * Delete a binding between this queue and an exchange
   * @param exchange
   * @param routingkey
   * @param args - arguments
   * @return
   */
  unbind(exchange: string, routingkey: string, args = {}) {
    const self = this
    return new Promise((resolve, reject) => {
      this.channel.queueUnbind(this.name, exchange, routingkey, args)
        .then(() => resolve(self))
        .catch(reject)
    })
  }

  /**
   * Publish a message directly to the queue
   * @param body - the data to be published, can be a string or an uint8array
   * @param properties - publish properties
   * @return - fulfilled when the message is enqueue on the socket, or if publish confirm is enabled when the message is confirmed by the server
   */
  publish(body: string|Uint8Array|ArrayBuffer, properties: AMQPProperties = {}) {
    const self = this
    return new Promise((resolve, reject) => {
      this.channel.basicPublish("", this.name, body, properties)
        .then(() => resolve(self))
        .catch(reject)
    })
  }

  /**
   * Subscribe to the queue
   * @param params
   * @param [params.noAck=true] - if messages are removed from the server upon delivery, or have to be acknowledged
   * @param [params.exclusive=false] - if this can be the only consumer of the queue, will return an Error if there are other consumers to the queue already
   * @param [params.tag=""] - tag of the consumer, will be server generated if left empty
   * @param [params.args={}] - custom arguments
   * @param {function(AMQPMessage) : void} callback - Function to be called for each received message
   * @return
   */
  subscribe({noAck = true, exclusive = false, tag = "", args = {}} = {}, callback: (msg: AMQPMessage) => void) {
    return this.channel.basicConsume(this.name, {noAck, exclusive, tag, args}, callback)
  }

  /**
   * Unsubscribe from the queue
   * @param consumerTag
   * @return
   */
  unsubscribe(consumerTag: string): Promise<AMQPQueue> {
    const self = this
    return new Promise((resolve, reject) => {
      this.channel.basicCancel(consumerTag)
        .then(() => resolve(self))
        .catch(reject)
    })
  }

  /**
   * Delete the queue
   * @return
   */
  delete(): Promise<AMQPQueue> {
    const self = this
    return new Promise((resolve, reject) => {
      this.channel.queueDelete(this.name)
        .then(() => resolve(self))
        .catch(reject)
    })
  }

  /**
   * Poll the queue for messages
   * @param params
   * @param params.noAck - automatically acknowledge messages when received
   * @return
   */
  get({ noAck = true }) {
    return this.channel.basicGet(this.name, { noAck })
  }
}
