import { AMQPMessage } from './amqp-message.js'
import { AMQPChannel, ConsumeParams } from './amqp-channel.js'
import { AMQPProperties } from './amqp-properties.js'
import { AMQPConsumer } from './amqp-consumer.js'

/**
 * Convience class for queues
 */
export class AMQPQueue {
  readonly channel: AMQPChannel
  readonly name: string
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
   */
  bind(exchange: string, routingKey = "", args = {}) : Promise<AMQPQueue> {
    return new Promise<AMQPQueue>((resolve, reject) => {
      this.channel.queueBind(this.name, exchange, routingKey, args)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Delete a binding between this queue and an exchange
   */
  unbind(exchange: string, routingKey = "", args = {}) : Promise<AMQPQueue>{
    return new Promise<AMQPQueue>((resolve, reject) => {
      this.channel.queueUnbind(this.name, exchange, routingKey, args)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Publish a message directly to the queue
   * @param body - the data to be published, can be a string or an uint8array
   * @param properties - publish properties
   * @return fulfilled when the message is enqueue on the socket, or if publish confirm is enabled when the message is confirmed by the server
   */
  publish(body: string|Uint8Array|ArrayBuffer|Buffer|null, properties: AMQPProperties = {}): Promise<AMQPQueue> {
    return new Promise<AMQPQueue>((resolve, reject) => {
      this.channel.basicPublish("", this.name, body, properties)
        .then(() => resolve(this))
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
   */
  subscribe({ noAck = true, exclusive = false, tag = "", args = {} } = {} as ConsumeParams,
            callback: (msg: AMQPMessage) => void) : Promise<AMQPConsumer> {
    return this.channel.basicConsume(this.name, {noAck, exclusive, tag, args}, callback)
  }

  /**
   * Unsubscribe from the queue
   */
  unsubscribe(consumerTag: string): Promise<AMQPQueue> {
    return new Promise((resolve, reject) => {
      this.channel.basicCancel(consumerTag)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Delete the queue
   */
  delete(): Promise<AMQPQueue> {
    return new Promise((resolve, reject) => {
      this.channel.queueDelete(this.name)
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  /**
   * Poll the queue for messages
   * @param params
   * @param params.noAck - automatically acknowledge messages when received
   */
  get({ noAck = true } = {}) {
    return this.channel.basicGet(this.name, { noAck })
  }

  purge() {
    return this.channel.queuePurge(this.name)
  }
}
