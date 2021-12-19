import AMQPError from './amqp-error'
import AMQPView from './amqp-view'
import AMQPQueue from './amqp-queue'
import AMQPConsumer from './amqp-consumer'
import AMQPMessage from './amqp-message'
import AMQPBaseClient from './amqp-base-client'
import { AMQPProperties } from './amqp-properties'

/**
 * Represents an AMQP Channel. Almost all actions in AMQP are performed on a Channel.
 */
export default class AMQPChannel {
  connection: AMQPBaseClient
  id: number
  consumers = new Map<string, AMQPConsumer>()
  promises: [(arg0: any) => void, (err?: Error) => void][]
  unconfirmedPublishes: [number, (confirmId: number) => void, (err?: Error) => void][]
  closed = false
  confirmId = 0
  delivery?: AMQPMessage
  getMessage?: AMQPMessage
  returned?: AMQPMessage
  /**
   * @param connection - The connection this channel belongs to
   * @param id - ID of the channel
   */
  constructor(connection: AMQPBaseClient, id: number) {
    this.connection = connection
    this.id = id
    this.consumers = new Map()
    this.promises = []
    this.unconfirmedPublishes = []
  }

  /**
   * Declare a queue and return a AMQPQueue object.
   * @return Convient wrapper around a Queue object
   */
  queue(name = "", props = {}, args = {}): Promise<AMQPQueue> {
    return new Promise((resolve, reject) => {
      this.queueDeclare(name, props, args)
        .then(({name}) => resolve(new AMQPQueue(this, name)))
        .catch(reject)
    })
  }

  /**
   * Alias for basicQos
   * @param prefetchCount - max inflight messages
   */
  prefetch(prefetchCount: number) {
    return this.basicQos(prefetchCount)
  }

  /**
   * Default handler for Returned messages
   * @param message
   */
  onReturn(message: AMQPMessage) {
    console.error("Message returned from server", message)
  }

  /**
   * Close the channel gracefully
   * @param params
   * @param [params.code=200] - Close code
   * @param [params.reason=""] - Reason for closing the channel
   */
  close({ code = 200, reason = "" } = {}) {
    if (this.closed) return this.rejectClosed()
    this.closed = true
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(512))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 0); j += 4 // frameSize
    frame.setUint16(j, 20); j += 2 // class: channel
    frame.setUint16(j, 40); j += 2 // method: close
    frame.setUint16(j, code); j += 2 // reply code
    j += frame.setShortString(j, reason) // reply reason
    frame.setUint16(j, 0); j += 2 // failing-class-id
    frame.setUint16(j, 0); j += 2 // failing-method-id
    frame.setUint8(j, 206); j += 1 // frame end byte
    frame.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(frame, j)
  }

  /**
   * Synchronously receive a message from a queue
   * @param queue - name of the queue to poll
   * @param param
   * @param [param.noAck=true] - if message is removed from the server upon delivery, or have to be acknowledged
   * @return - returns null if the queue is empty otherwise a single message
   */
  basicGet(queue: string, { noAck = true } = {}): Promise<AMQPMessage|undefined> {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(512))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel: 1
    frame.setUint32(j, 11); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 70); j += 2 // method: get
    frame.setUint16(j, 0); j += 2 // reserved1
    j += frame.setShortString(j, queue) // queue
    frame.setUint8(j, noAck ? 1 : 0); j += 1 // noAck
    frame.setUint8(j, 206); j += 1 // frame end byte
    frame.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(frame, j)
  }

  /**
   * Consume from a queue. Messages will be delivered asynchronously.
   * @param queue - name of the queue to poll
   * @param param
   * @param [param.tag=""] - tag of the consumer, will be server generated if left empty
   * @param [param.noAck=true] - if messages are removed from the server upon delivery, or have to be acknowledged
   * @param [param.exclusive=false] - if this can be the only consumer of the queue, will return an Error if there are other consumers to the queue already
   * @param [param.args={}] - custom arguments
   * @param {function(AMQPMessage) : void} callback - will be called for each message delivered to this consumer
   */
  basicConsume(queue: string, {tag = "", noAck = true, exclusive = false, args = {}} = {}, callback: (msg: AMQPMessage) => void) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const noWait = false
    const noLocal = false
    const frame = new AMQPView(new ArrayBuffer(4096))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel: 1
    frame.setUint32(j, 0); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 20); j += 2 // method: consume
    frame.setUint16(j, 0); j += 2 // reserved1
    j += frame.setShortString(j, queue) // queue
    j += frame.setShortString(j, tag) // tag
    let bits = 0
    if (noLocal)   bits = bits | (1 << 0)
    if (noAck)     bits = bits | (1 << 1)
    if (exclusive) bits = bits | (1 << 2)
    if (noWait)    bits = bits | (1 << 3)
    frame.setUint8(j, bits); j += 1 // noLocal/noAck/exclusive/noWait
    j += frame.setTable(j, args) // arguments table
    frame.setUint8(j, 206); j += 1 // frame end byte
    frame.setUint32(3, j - 8) // update frameSize

    return new Promise((resolve, reject) => {
      this.sendRpc(frame, j).then((consumerTag) =>  {
        const consumer = new AMQPConsumer(this, consumerTag, callback)
        this.consumers.set(consumerTag, consumer)
        resolve(consumer)
      }).catch(reject)
    })
  }

  /**
   * Cancel/stop a consumer
   * @param tag - consumer tag
   */
  basicCancel(tag: string) {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(512))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel: 1
    frame.setUint32(j, 0); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 30); j += 2 // method: cancel
    j += frame.setShortString(j, tag) // tag
    frame.setUint8(j, noWait ? 1 : 0); j += 1 // noWait
    frame.setUint8(j, 206); j += 1 // frame end byte
    frame.setUint32(3, j - 8) // update frameSize

    return new Promise((resolve, reject) => {
      this.sendRpc(frame, j).then((consumerTag) => {
        const consumer = this.consumers.get(consumerTag)
        if (consumer) {
          consumer.setClosed()
          this.consumers.delete(consumerTag)
        }
        resolve(this)
      }).catch(reject)
    })
  }

  /**
   * Acknowledge a delivered message
   * @param deliveryTag - tag of the message
   * @param [multiple=false] - batch confirm all messages up to this delivery tag
   */
  basicAck(deliveryTag: number, multiple = false) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(21))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 13); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 80); j += 2 // method: ack
    frame.setUint64(j, deliveryTag); j += 8
    frame.setUint8(j, multiple ? 1 : 0); j += 1
    frame.setUint8(j, 206); j += 1 // frame end byte
    return this.connection.send(new Uint8Array(frame.buffer, 0, 21))
  }

  /**
   * Acknowledge a delivered message
   * @param deliveryTag - tag of the message
   * @param [requeue=false] - if the message should be requeued or removed
   * @param [multiple=false] - batch confirm all messages up to this delivery tag
   */
  basicNack(deliveryTag: number, requeue = false, multiple = false) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(21))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 13); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 120); j += 2 // method: nack
    frame.setUint64(j, deliveryTag); j += 8
    let bits = 0
    if (multiple) bits = bits | (1 << 0)
    if (requeue)  bits = bits | (1 << 1)
    frame.setUint8(j, bits); j += 1
    frame.setUint8(j, 206); j += 1 // frame end byte
    return this.connection.send(new Uint8Array(frame.buffer, 0, 21))
  }

  /**
   * Acknowledge a delivered message
   * @param deliveryTag - tag of the message
   * @param [requeue=false] - if the message should be requeued or removed
   */
  basicReject(deliveryTag: number, requeue = false) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(21))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 13); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 90); j += 2 // method: reject
    frame.setUint64(j, deliveryTag); j += 8
    frame.setUint8(j, requeue ? 1 : 0); j += 1
    frame.setUint8(j, 206); j += 1 // frame end byte
    return this.connection.send(new Uint8Array(frame.buffer, 0, 21))
  }

  /**
   * Tell the server to redeliver all unacknowledged messages again, or reject and requeue them.
   * @param [requeue=false] - if the message should be requeued or redeliviered to this channel
   */
  basicRecover(requeue = false) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(13))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 5); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 110); j += 2 // method: recover
    frame.setUint8(j, requeue ? 1 : 0); j += 1
    frame.setUint8(j, 206); j += 1 // frame end byte
    return this.sendRpc(frame, j)
  }

  /**
   * Publish a message
   * @param exchange - the exchange to publish to, the exchange must exists
   * @param routingKey - routing key
   * @param data - the data to be published, can be a string or an uint8array
   * @param [mandatory] - if the message should be returned if there's no queue to be delivered to
   * @param [immediate] - if the message should be returned if it can't be delivered to a consumer immediately (not supported in RabbitMQ)
   * @return - fulfilled when the message is enqueue on the socket, or if publish confirm is enabled when the message is confirmed by the server
   */
  basicPublish(exchange: string, routingKey: string, data: string|Uint8Array|ArrayBuffer, properties: AMQPProperties = {}, mandatory = false, immediate = false) {
    if (this.closed) return this.rejectClosed()
    if (this.connection.blocked)
      return Promise.reject(new AMQPError(`Connection blocked by server: ${this.connection.blocked}`, this.connection))

    /** @type {Uint8Array} */
    let body 
    if (data instanceof Uint8Array) {
      body = data
    } else if (data instanceof ArrayBuffer) {
      body = new Uint8Array(data)
    } else if (typeof data === "string") {
      const encoder = new TextEncoder()
      body = encoder.encode(data)
    } else {
      const json = JSON.stringify(data)
      const encoder = new TextEncoder()
      body = encoder.encode(json)
    }

    const promises = new Array<Promise<void>>()
    let j = 0
    let buffer = new AMQPView(new ArrayBuffer(16384))
    buffer.setUint8(j, 1); j += 1 // type: method
    buffer.setUint16(j, this.id); j += 2 // channel
    j += 4 // frame size, update later
    buffer.setUint16(j, 60); j += 2 // class: basic
    buffer.setUint16(j, 40); j += 2 // method: publish
    buffer.setUint16(j, 0); j += 2 // reserved1
    j += buffer.setShortString(j, exchange) // exchange
    j += buffer.setShortString(j, routingKey) // routing key
    let bits = 0
    if (mandatory) bits = bits | (1 << 0)
    if (immediate) bits = bits | (1 << 1)
    buffer.setUint8(j, bits); j += 1 // mandatory/immediate
    buffer.setUint8(j, 206); j += 1 // frame end byte
    buffer.setUint32(3, j - 8) // update frameSize

    const headerStart = j
    buffer.setUint8(j, 2); j += 1 // type: header
    buffer.setUint16(j, this.id); j += 2 // channel
    j += 4 // frame size, update later
    buffer.setUint16(j, 60); j += 2 // class: basic
    buffer.setUint16(j, 0); j += 2 // weight
    buffer.setUint32(j, 0); j += 4 // bodysize (upper 32 of 64 bits)
    buffer.setUint32(j, body.byteLength); j += 4 // bodysize
    j += buffer.setProperties(j, properties); // properties
    buffer.setUint8(j, 206); j += 1 // frame end byte
    buffer.setUint32(headerStart + 3, j - headerStart - 8) // update frameSize

    // Send current frames if there's no body to send
    if (body.byteLength === 0) {
      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j))
      promises.push(p)
    } else if (j >= 16384 - 8) {
      // Send current frames if a body frame can't fit in the rest of the frame buffer
      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j))
      promises.push(p)
      j = 0
    }

    // split body into multiple frames if body > frameMax
    for (let bodyPos = 0; bodyPos < body.byteLength;) {
      const frameSize = Math.min(body.byteLength - bodyPos, 16384 - 8 - j) // frame overhead is 8 bytes
      const dataSlice = body.subarray(bodyPos, bodyPos + frameSize)

      if (j === 0)
        buffer = new AMQPView(new ArrayBuffer(frameSize + 8))
      buffer.setUint8(j, 3); j += 1 // type: body
      buffer.setUint16(j, this.id); j += 2 // channel
      buffer.setUint32(j, frameSize); j += 4 // frameSize
      const bodyView = new Uint8Array(buffer.buffer, j, frameSize)
      bodyView.set(dataSlice); j += frameSize // body content
      buffer.setUint8(j, 206); j += 1 // frame end byte
      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j))
      promises.push(p)
      bodyPos += frameSize
      j = 0
    }
    // if publish confirm is enabled, put a promise on a queue if the sends were ok
    // the promise on the queue will be fullfilled by the read loop when an ack/nack
    // comes from the server
    if (this.confirmId) {
      return new Promise((resolve, reject) =>
        Promise.all(promises)
        .then(() => this.unconfirmedPublishes.push([this.confirmId++, resolve, reject]))
        .catch(reject)
      )
    } else {
      return new Promise((resolve, reject) =>
        Promise.all(promises)
        .then(() => resolve(0))
        .catch(reject))
    }
  }

  /**
   * Set prefetch limit.
   * Recommended to set as each unacknowledge message will be store in memory of the client.
   * The server won't deliver more messages than the limit until messages are acknowledged.
   * @param prefetchCount - number of messages to limit to
   * @param prefetchSize - number of bytes to limit to (not supported by RabbitMQ)
   * @param global - if the prefetch is limited to the channel, or if false to each consumer
   */
  basicQos(prefetchCount: number, prefetchSize = 0, global = false) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(19))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel: 1
    frame.setUint32(j, 11); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 10); j += 2 // method: qos
    frame.setUint32(j, prefetchSize); j += 4 // prefetch size
    frame.setUint16(j, prefetchCount); j += 2 // prefetch count
    frame.setUint8(j, global ? 1 : 0); j += 1 // glocal
    frame.setUint8(j, 206); j += 1 // frame end byte
    return this.sendRpc(frame, j)
  }

  /**
   * Enable or disable flow. Disabling flow will stop the server from delivering messages to consumers.
   * Not supported in RabbitMQ
   * @param active - false to stop the flow, true to accept messages
   */
  basicFlow(active = true) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(13))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel: 1
    frame.setUint32(j, 5); j += 4 // frameSize
    frame.setUint16(j, 20); j += 2 // class: channel
    frame.setUint16(j, 20); j += 2 // method: flow
    frame.setUint8(j, active ? 1 : 0); j += 1 // active flow
    frame.setUint8(j, 206); j += 1 // frame end byte
    return this.sendRpc(frame, j)
  }

  /**
   * Enable publish confirm. The server will then confirm each publish with an Ack or Nack when the message is enqueued.
   */
  confirmSelect() {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(13))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 5); j += 4 // frame size
    frame.setUint16(j, 85); j += 2 // class: confirm
    frame.setUint16(j, 10); j += 2 // method: select
    frame.setUint8(j, 0); j += 1 // noWait
    frame.setUint8(j, 206); j += 1 // frame end byte
    return this.sendRpc(frame, j) // parseFrames in base will set channel.confirmId = 0
  }

  /**
   * Declare a queue
   * @param name - name of the queue, if empty the server will generate a name
   * @param params
   * @param [params.passive=false] - if the queue name doesn't exists the channel will be closed with an error, fulfilled if the queue name does exists
   * @param [params.durable=true] - if the queue should survive server restarts
   * @param [params.autoDelete=false] - if the queue should be deleted when the last consumer of the queue disconnects
   * @param [params.exclusive=false] - if the queue should be deleted when the channel is closed
   * @param args - optional custom queue arguments
   * @return fulfilled when confirmed by the server
   */
  queueDeclare(name = "", {passive = false, durable = name !== "", autoDelete = name === "", exclusive = name === ""} = {}, args = {}) {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    let j = 0
    const declare = new AMQPView(new ArrayBuffer(4096))
    declare.setUint8(j, 1); j += 1 // type: method
    declare.setUint16(j, this.id); j += 2 // channel: 1
    declare.setUint32(j, 0); j += 4 // frameSize
    declare.setUint16(j, 50); j += 2 // class: queue
    declare.setUint16(j, 10); j += 2 // method: declare
    declare.setUint16(j, 0); j += 2 // reserved1
    j += declare.setShortString(j, name) // name
    let bits = 0
    if (passive)    bits = bits | (1 << 0)
    if (durable)    bits = bits | (1 << 1)
    if (exclusive)  bits = bits | (1 << 2)
    if (autoDelete) bits = bits | (1 << 3)
    if (noWait)     bits = bits | (1 << 4)
    declare.setUint8(j, bits); j += 1
    j += declare.setTable(j, args) // arguments
    declare.setUint8(j, 206); j += 1 // frame end byte
    declare.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(declare, j)
  }

  /**
   * Delete a queue
   * @param name - name of the queue, if empty it will delete the last declared queue
   * @param params
   * @param [params.ifUnused=false] - only delete if the queue doesn't have any consumers
   * @param [params.ifEmpty=false] - only delete if the queue is empty
   */
  queueDelete(name = "", { ifUnused = false, ifEmpty = false } = {}) {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(512))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel: 1
    frame.setUint32(j, 0); j += 4 // frameSize
    frame.setUint16(j, 50); j += 2 // class: queue
    frame.setUint16(j, 40); j += 2 // method: delete
    frame.setUint16(j, 0); j += 2 // reserved1
    j += frame.setShortString(j, name) // name
    let bits = 0
    if (ifUnused) bits = bits | (1 << 0)
    if (ifEmpty)  bits = bits | (1 << 1)
    if (noWait)   bits = bits | (1 << 2)
    frame.setUint8(j, bits); j += 1
    frame.setUint8(j, 206); j += 1 // frame end byte
    frame.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(frame, j)
  }

  /**
   * Bind a queue to an exchange
   * @param queue - name of the queue
   * @param exchange - name of the exchange
   * @param routingKey - key to bind with
   * @param args - optional arguments, e.g. for header exchanges
   * @return fulfilled when confirmed by the server
   */
  queueBind(queue: string, exchange: string, routingKey: string, args = {}) {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    let j = 0
    const bind = new AMQPView(new ArrayBuffer(4096))
    bind.setUint8(j, 1); j += 1 // type: method
    bind.setUint16(j, this.id); j += 2 // channel: 1
    bind.setUint32(j, 0); j += 4 // frameSize
    bind.setUint16(j, 50); j += 2 // class: queue
    bind.setUint16(j, 20); j += 2 // method: bind
    bind.setUint16(j, 0); j += 2 // reserved1
    j += bind.setShortString(j, queue)
    j += bind.setShortString(j, exchange)
    j += bind.setShortString(j, routingKey)
    bind.setUint8(j, noWait ? 1 : 0); j += 1 // noWait
    j += bind.setTable(j, args)
    bind.setUint8(j, 206); j += 1 // frame end byte
    bind.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(bind, j)
  }

  /**
   * Unbind a queue from an exchange
   * @param queue - name of the queue
   * @param exchange - name of the exchange
   * @param routingKey - key that was bound
   * @param args - arguments, e.g. for header exchanges
   * @return fulfilled when confirmed by the server
   */
  queueUnbind(queue: string, exchange: string, routingKey: string, args = {}) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const unbind = new AMQPView(new ArrayBuffer(4096))
    unbind.setUint8(j, 1); j += 1 // type: method
    unbind.setUint16(j, this.id); j += 2 // channel: 1
    unbind.setUint32(j, 0); j += 4 // frameSize
    unbind.setUint16(j, 50); j += 2 // class: queue
    unbind.setUint16(j, 50); j += 2 // method: unbind
    unbind.setUint16(j, 0); j += 2 // reserved1
    j += unbind.setShortString(j, queue)
    j += unbind.setShortString(j, exchange)
    j += unbind.setShortString(j, routingKey)
    j += unbind.setTable(j, args)
    unbind.setUint8(j, 206); j += 1 // frame end byte
    unbind.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(unbind, j)
  }

  /**
   * Purge a queue
   * @param queue - name of the queue
   * @return fulfilled when confirmed by the server
   */
  queuePurge(queue: string) {
    if (this.closed) return this.rejectClosed()
    const noWait = true
    let j = 0
    const purge = new AMQPView(new ArrayBuffer(512))
    purge.setUint8(j, 1); j += 1 // type: method
    purge.setUint16(j, this.id); j += 2 // channel: 1
    purge.setUint32(j, 0); j += 4 // frameSize
    purge.setUint16(j, 50); j += 2 // class: queue
    purge.setUint16(j, 30); j += 2 // method: purge
    purge.setUint16(j, 0); j += 2 // reserved1
    j += purge.setShortString(j, queue)
    purge.setUint8(j, noWait ? 1 : 0); j += 1 // noWait
    purge.setUint8(j, 206); j += 1 // frame end byte
    purge.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(purge, j)
  }

  /**
   * Declare an exchange
   * @param name - name of the exchange
   * @param type - type of exchange (direct, fanout, topic, header, or a custom type)
   * @param param
   * @param [param.passive=false] - if the exchange name doesn't exists the channel will be closed with an error, fulfilled if the exchange name does exists
   * @param [param.durable=true] - if the exchange should survive server restarts
   * @param [param.autoDelete=false] - if the exchange should be deleted when the last binding from it is deleted
   * @param [param.internal=false] - if exchange is internal to the server. Client's can't publish to internal exchanges.
   * @param args - optional arguments
   * @return Fulfilled when the exchange is created or if it already exists
   */
  exchangeDeclare(name: string, type: string, { passive = false, durable = true, autoDelete = false, internal = false } = {}, args = {}) {
    const noWait = false
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(4096))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 0); j += 4 // frame size
    frame.setUint16(j, 40); j += 2 // class: exchange
    frame.setUint16(j, 10); j += 2 // method: declare
    frame.setUint16(j, 0); j += 2 // reserved1
    j += frame.setShortString(j, name)
    j += frame.setShortString(j, type)
    let bits = 0
    if (passive)    bits = bits | (1 << 0)
    if (durable)    bits = bits | (1 << 1)
    if (autoDelete) bits = bits | (1 << 2)
    if (internal)   bits = bits | (1 << 3)
    if (noWait)     bits = bits | (1 << 4)
    frame.setUint8(j, bits); j += 1
    j += frame.setTable(j, args)
    frame.setUint8(j, 206); j += 1 // frame end byte
    frame.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(frame, j)
  }

  /**
   * Delete an exchange
   * @param name - name of the exchange
   * @param param
   * @param [param.ifUnused=false] - only delete if the exchange doesn't have any bindings
   * @return Fulfilled when the exchange is deleted or if it's already deleted
   */
  exchangeDelete(name: string, { ifUnused = false } = {}) {
    const noWait = false
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(512))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 0); j += 4 // frame size
    frame.setUint16(j, 40); j += 2 // class: exchange
    frame.setUint16(j, 20); j += 2 // method: declare
    frame.setUint16(j, 0); j += 2 // reserved1
    j += frame.setShortString(j, name)
    let bits = 0
    if (ifUnused) bits = bits | (1 << 0)
    if (noWait)   bits = bits | (1 << 1)
    frame.setUint8(j, bits); j += 1
    frame.setUint8(j, 206); j += 1 // frame end byte
    frame.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(frame, j)
  }

  /**
   * Exchange to exchange binding.
   * @param destination - name of the destination exchange
   * @param source - name of the source exchange
   * @param routingKey - key to bind with
   * @param args - optional arguments, e.g. for header exchanges
   * @return fulfilled when confirmed by the server
   */
  exchangeBind(destination: string, source: string, routingKey = "", args = {}) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const bind = new AMQPView(new ArrayBuffer(4096))
    bind.setUint8(j, 1); j += 1 // type: method
    bind.setUint16(j, this.id); j += 2 // channel: 1
    bind.setUint32(j, 0); j += 4 // frameSize
    bind.setUint16(j, 40); j += 2 // class: exchange
    bind.setUint16(j, 30); j += 2 // method: bind
    bind.setUint16(j, 0); j += 2 // reserved1
    j += bind.setShortString(j, destination)
    j += bind.setShortString(j, source)
    j += bind.setShortString(j, routingKey)
    bind.setUint8(j, 0); j += 1 // noWait
    j += bind.setTable(j, args)
    bind.setUint8(j, 206); j += 1 // frame end byte
    bind.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(bind, j)
  }

  /**
   * Delete an exchange-to-exchange binding
   * @param destination - name of destination exchange
   * @param source - name of the source exchange
   * @param routingKey - key that was bound
   * @param args - arguments, e.g. for header exchanges
   * @return fulfilled when confirmed by the server
   */
  exchangeUnbind(destination: string, source: string, routingKey = "", args = {}) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const unbind = new AMQPView(new ArrayBuffer(4096))
    unbind.setUint8(j, 1); j += 1 // type: method
    unbind.setUint16(j, this.id); j += 2 // channel: 1
    unbind.setUint32(j, 0); j += 4 // frameSize
    unbind.setUint16(j, 40); j += 2 // class: exchange
    unbind.setUint16(j, 40); j += 2 // method: unbind
    unbind.setUint16(j, 0); j += 2 // reserved1
    j += unbind.setShortString(j, destination)
    j += unbind.setShortString(j, source)
    j += unbind.setShortString(j, routingKey)
    unbind.setUint8(j, 0); j += 1 // noWait
    j += unbind.setTable(j, args)
    unbind.setUint8(j, 206); j += 1 // frame end byte
    unbind.setUint32(3, j - 8) // update frameSize
    return this.sendRpc(unbind, j)
  }

  /**
   * Set this channel in Transaction mode.
   * Rember to commit the transaction, overwise the server will eventually run out of memory.
   */
  txSelect() {
    return this.txMethod(10)
  }

  /**
   * Commit a transaction
   */
  txCommit() {
    return this.txMethod(20)
  }

  /**
   * Rollback a transaction
   */
  txRollback() {
    return this.txMethod(30)
  }

  /**
   * @private
   * @param methodId
   */
  txMethod(methodId: number) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(12))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel: 1
    frame.setUint32(j, 4); j += 4 // frameSize
    frame.setUint16(j, 90); j += 2 // class: Tx
    frame.setUint16(j, methodId); j += 2
    frame.setUint8(j, 206); j += 1 // frame end byte
    return this.sendRpc(frame, j)
  }

  /**
   * Resolves the next RPC promise
   * @ignore
   * @param [value]
   * @return true if a promise was resolved, otherwise false
   */
  resolvePromise(value?: any) {
    const promise  = this.promises.shift()
    if (promise) {
      const [resolve, ] = promise
      resolve(value)
      return true
    }
    return false
  }

  /**
   * Rejects the next RPC promise
   * @ignore
   * @param [err]
   * @return true if a promise was rejected, otherwise false
   */
  rejectPromise(err?: Error) {
    const promise  = this.promises.shift()
    if (promise) {
      const [, reject] = promise
      reject(err)
      return true
    }
    return false
  }

  /**
   * Send a RPC request, will resolve a RPC promise when RPC response arrives
   * @private
   * @param frame with data
   * @param frameSize - bytes the frame actually is
   */
  sendRpc(frame: AMQPView, frameSize: number): Promise<any> {
    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(frame.buffer, 0, frameSize))
        .then(() => this.promises.push([resolve, reject]))
        .catch(reject)
    })
  }

  /**
   * Marks the channel as closed
   * All outstanding RPC requests will be rejected
   * All outstanding publish confirms will be rejected
   * All consumers will be marked as closed
   * @ignore
   * @param [err] - why the channel was closed
   */
  setClosed(err?: Error) {
    if (!this.closed) {
      this.closed = true
      this.consumers.forEach((consumer) => consumer.setClosed(err))
      this.consumers.clear()
      // Empty and reject all RPC promises
      while(this.rejectPromise(err)) { 1 }
      this.unconfirmedPublishes.forEach(([, , reject]) => reject(err))
    }
  }

  /**
   * @ignore
   * @return Rejected promise with an error
   */
  rejectClosed() {
    return Promise.reject(new AMQPError("Channel is closed", this.connection))
  }

  /**
   * Called from AMQPBaseClient when a publish is confirmed by the server.
   * Will fulfill one or more (if multiple) Unconfirmed Publishes.
   * @ignore
   * @param deliveryTag
   * @param multiple - true if all unconfirmed publishes up to this deliveryTag should be resolved or just this one
   * @param nack - true if negative confirm, hence reject the unconfirmed publish(es)
   */
  publishConfirmed(deliveryTag: number, multiple: boolean, nack: boolean) {
    // is queueMicrotask() needed here?
    const idx = this.unconfirmedPublishes.findIndex(([tag,]) => tag === deliveryTag)
    if (idx !== -1) {
      const confirmed = multiple ?
        this.unconfirmedPublishes.splice(0, idx + 1) :
        this.unconfirmedPublishes.splice(idx, 1)
      confirmed.forEach(([tag, resolve, reject]) => {
        if (nack)
          reject(new Error("Message rejected"))
        else
          resolve(tag)
      })
    } else {
      console.warn("Cant find unconfirmed deliveryTag", deliveryTag, "multiple:", multiple, "nack:", nack)
    }
  }

  /**
   * Called from AMQPBaseClient when a message is ready
   * @ignore
   * @param message
   */
  onMessageReady(message: AMQPMessage) {
    if (this.delivery) {
      this.delivery = undefined
      this.deliver(message)
    } else if (this.getMessage) {
      this.getMessage = undefined
      this.resolvePromise(message)
    } else {
      this.returned = undefined
      this.onReturn(message)
    }
  }

  /**
   * Deliver a message to a consumer
   * @ignore
   * @param message
   */
  deliver(message: AMQPMessage) {
    queueMicrotask(() => {
      const consumer = this.consumers.get(message.consumerTag)
      if (consumer) {
        consumer.onMessage(message)
      } else {
        throw(new AMQPError(`Consumer ${message.consumerTag} on channel ${this.id} doesn't exists`, this.connection))
      }
    })
  }
}
