import AMQPError from './amqp-error.mjs'
import AMQPQueue from './amqp-queue.mjs'
import AMQPView from './amqp-view.mjs'
import AMQPConsumer from './amqp-consumer.mjs'

/**
 * Represents an AMQP Channel. Almost all actions in AMQP are performed on a Channel.
 * @param {AMQPBaseClient} connection - The connection this channel belongs to
 * @param {number} id - ID of the channel
 */
export default class AMQPChannel {
  constructor(connection, id) {
    this.connection = connection
    this.id = id
    this.consumers = {}
    this.promises = []
    this.unconfirmedPublishes = []
    this.closed = false
  }

  /**
   * Declare a queue and return a AMQPQueue object.
   * @return {Promise<AMQPQueue, AMQPError>} Convient wrapper around a Queue object
   */
  queue(name = "", props = {}, args = {}) {
    return new Promise((resolve, reject) => {
      this.queueDeclare(name, props, args)
        .then(({name}) => resolve(new AMQPQueue(this, name)))
        .catch(reject)
    })
  }

  /**
   * Alias for basicQos
   */
  prefetch(prefetchCount) {
    return this.basicQos(prefetchCount)
  }

  /**
   * Default handler for Returned messages
   * @param {AMQPMessage} message
   */
  onReturn(message) {
    console.error("Message returned from server", message)
  }

  /**
   * Close the channel gracefully
   * @param {object} params
   * @param {number} params.code - Close code
   * @param {string} params.reason - Reason for closing the channel
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
   * @param {string} queue - name of the queue to poll
   * @param {object} param
   * @param {boolean} [param.noAck=true] - if message is removed from the server upon delivery, or have to be acknowledged
   * @return {Promise<AMQPMessage|null, AMQPError>} - returns null if the queue is empty otherwise a single message
   */
  basicGet(queue, { noAck = true } = {}) {
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
   * @param {string} queue - name of the queue to poll
   * @param {object} param
   * @param {string} [param.tag=""] - tag of the consumer, will be server generated if left empty
   * @param {boolean} [param.noAck=true] - if messages are removed from the server upon delivery, or have to be acknowledged
   * @param {boolean} [param.exclusive=false] - if this can be the only consumer of the queue, will return an Error if there are other consumers to the queue already
   * @param {object} [param.args={}] - custom arguments
   * @param {function(message: AMQPMessage)} callback - will be called for each message delivered to this consumer
   * @return {Promise<AMQPConsumer, AMQPError>}
   */
  basicConsume(queue, {tag = "", noAck = true, exclusive = false, args = {}} = {}, callback) {
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
        this.consumers[consumerTag] = consumer
        resolve(consumer)
      }).catch(reject)
    })
  }

  /**
   * Cancel/stop a consumer
   * @param {string} tag - consumer tag
   * @return {Promise<AMQPChannel, AMQPError>}
   */
  basicCancel(tag) {
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
        const consumer = this.consumers[consumerTag]
        if (consumer) {
          consumer.setClosed()
          delete this.consumers[consumerTag]
        }
        resolve(this)
      }).catch(reject)
    })
  }

  /**
   * Acknowledge a delivered message
   * @param {string} deliveryTag - tag of the message
   * @param {boolean} [multiple=false] - batch confirm all messages up to this delivery tag
   * @return {Promise<, AMQPError>}
   */
  basicAck(deliveryTag, multiple = false) {
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
   * @param {string} deliveryTag - tag of the message
   * @param {boolean} [requeue=false] - if the message should be requeued or removed
   * @param {boolean} [multiple=false] - batch confirm all messages up to this delivery tag
   * @return {Promise<, AMQPError>}
   */
  basicNack(deliveryTag, requeue = false, multiple = false) {
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
   * @param {string} deliveryTag - tag of the message
   * @param {boolean} [requeue=false] - if the message should be requeued or removed
   * @return {Promise<, AMQPError>}
   */
  basicReject(deliveryTag, requeue = false) {
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
   * @param {boolean} [requeue=false] - if the message should be requeued or redeliviered to this channel
   * @return {Promise<, AMQPError>}
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
   * @param {string} exchange - the exchange to publish to, the exchange must exists
   * @param {string} routingKey - routing key
   * @param {string|uint8array} data - the data to be published, can be a string or an uint8array
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
   * @param {boolean} [mandatory] - if the message should be returned if there's no queue to be delivered to
   * @param {boolean} [immediate] - if the message should be returned if it can't be delivered to a consumer immediately (not supported in RabbitMQ)
   * @return {Promise<number, AMQPError>} - fulfilled when the message is enqueue on the socket, or if publish confirm is enabled when the message is confirmed by the server
   */
  basicPublish(exchange, routingKey, data, properties, mandatory, immediate) {
    if (this.closed) return this.rejectClosed()
    if (this.connection.blocked)
      return Promise.reject(new AMQPError(`Connection blocked by server: ${this.connection.blocked}`, this.connection))

    if (data instanceof Uint8Array) {
      // noop
    } else if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data)
    } else if (typeof data === "string") {
      const encoder = new TextEncoder()
      data = encoder.encode(data)
    } else {
      const json = JSON.stringify(data)
      const encoder = new TextEncoder()
      data = encoder.encode(json)
    }

    const promises = []
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
    buffer.setUint32(j, data.byteLength); j += 4 // bodysize
    j += buffer.setProperties(j, properties); // properties
    buffer.setUint8(j, 206); j += 1 // frame end byte
    buffer.setUint32(headerStart + 3, j - headerStart - 8) // update frameSize

    // Send current frames if there's no body to send
    if (data.byteLength === 0) {
      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j))
      promises.push(p)
    } else if (j >= 16384 - 8) {
      // Send current frames if a body frame can't fit in the rest of the frame buffer
      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j))
      promises.push(p)
      j = 0
    }

    // split body into multiple frames if body > frameMax
    for (let bodyPos = 0; bodyPos < data.byteLength;) {
      const frameSize = Math.min(data.byteLength - bodyPos, 16384 - 8 - j) // frame overhead is 8 bytes
      const dataSlice = new Uint8Array(data.buffer, bodyPos, frameSize)

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
    if (this.confirmId !== undefined) {
      return new Promise((resolve, reject) =>
        Promise.all(promises)
          .then(() => this.unconfirmedPublishes.push([++this.confirmId, resolve, reject]))
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
   * @param {number} prefetchCount - number of messages to limit to
   * @param {number} prefetchSize - number of bytes to limit to (not supported by RabbitMQ)
   * @param {boolean} global - if the prefetch is limited to the channel, or if false to each consumer
   * @return {Promise<, AMQPError>}
   */
  basicQos(prefetchCount, prefetchSize = 0, global = false) {
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
   * @param {boolean} active
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
   * @return {Promise<, AMQPError>}
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
   * @param {string} name - name of the queue, if empty the server will generate a name
   * @param {object} params
   * @param {boolean} params.passive - if the queue name doesn't exists the channel will be closed with an error, fulfilled if the queue name does exists
   * @param {boolean} params.durable - if the queue should survive server restarts
   * @param {boolean} params.autoDelete - if the queue should be deleted when the last consumer of the queue disconnects
   * @param {boolean} params.exclusive - if the queue should be deleted when the channel is closed
   * @param {object} args - optional custom queue arguments
   * @return {Promise<{queueName: string, messages: number, consumers: number}, AMQPError>} fulfilled when confirmed by the server
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
   * @param {string} name - name of the queue, if empty it will delete the last declared queue
   * @param {object} params
   * @param {boolean} params.ifUnused - only delete if the queue doesn't have any consumers
   * @param {boolean} params.ifEmpty - only delete if the queue is empty
   * @return {Promise<{messageCount: number}, AMQPError>}
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
   * @param {string} queue - name of the queue
   * @param {string} exchange - name of the exchange
   * @param {string} routingKey - key to bind with
   * @param {object} args - optional arguments, e.g. for header exchanges
   * @return {Promise} fulfilled when confirmed by the server
   */
  queueBind(queue, exchange, routingKey, args = {}) {
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
   * @param {string} queue - name of the queue
   * @param {string} exchange - name of the exchange
   * @param {string} routingKey - key that was bound
   * @param {object} args - arguments, e.g. for header exchanges
   * @return {Promise} fulfilled when confirmed by the server
   */
  queueUnbind(queue, exchange, routingKey, args = {}) {
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
   * @param {string} queue - name of the queue
   * @return {Promise} fulfilled when confirmed by the server
   */
  queuePurge(queue) {
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
   * @param {string} name - name of the exchange
   * @param {string} type - type of exchange (direct, fanout, topic, header, or a custom type)
   * @param {object} param
   * @param {boolean} param.passive - if the exchange name doesn't exists the channel will be closed with an error, fulfilled if the exchange name does exists
   * @param {boolean} param.durable - if the exchange should survive server restarts
   * @param {boolean} param.autoDelete - if the exchange should be deleted when the last binding from it is deleted
   * @param {boolean} param.internal - if exchange is internal to the server. Client's can't publish to internal exchanges.
   * @param {object} args - optional arguments
   * @return {Promise<, AMQPError>} Fulfilled when the exchange is created or if it already exists
   */
  exchangeDeclare(name, type, { passive = false, durable = true, autoDelete = false, internal = false } = {}, args = {}) {
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
   * @param {string} name - name of the exchange
   * @param {object} param
   * @param {boolean} param.ifUnused - only delete if the exchange doesn't have any bindings
   * @return {Promise<, AMQPError>} Fulfilled when the exchange is deleted or if it's already deleted
   */
  exchangeDelete(name, { ifUnused = false } = {}) {
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
   * @param {string} destination - name of the destination exchange
   * @param {string} exchange - name of the source exchange
   * @param {string} routingKey - key to bind with
   * @param {object} args - optional arguments, e.g. for header exchanges
   * @return {Promise<, AMQPError>} fulfilled when confirmed by the server
   */
  exchangeBind(destination, source, routingKey = "", args = {}) {
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
   * @param {string} queue - name of the queue
   * @param {string} exchange - name of the exchange
   * @param {string} routingKey - key that was bound
   * @param {object} args - arguments, e.g. for header exchanges
   * @return {Promise} fulfilled when confirmed by the server
   */
  exchangeUnbind(destination, source, routingKey = "", args = {}) {
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

  txMethod(methodId) {
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
   * @return {Bool} true if a promise was resolved, otherwise false
   */
  resolvePromise(value) {
    if (this.promises.length === 0) return false
    const [resolve, ] = this.promises.shift()
    resolve(value)
    return true
  }

  /**
   * Rejects the next RPC promise
   * @ignore
   * @return {Bool} true if a promise was rejected, otherwise false
   */
  rejectPromise(err) {
    if (this.promises.length === 0) return false
    const [, reject] = this.promises.shift()
    reject(err)
    return true
  }

  /**
   * Send a RPC request, will resolve a RPC promise when RPC response arrives
   * @ignore
   * @param {AMQPView} frame with data
   * @param {number} how long the frame actually is
   */
  sendRpc(frame, frameSize) {
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
   * @param {Error} err - why the channel was closed
   * @protected
   */
  setClosed(err) {
    if (!this.closed) {
      this.closed = true
      Object.values(this.consumers).forEach((consumer) => consumer.setClosed(err))
      this.consumers = []
      // Empty and reject all RPC promises
      while(this.rejectPromise(err)) { 1 }
      this.unconfirmedPublishes.forEach(([, , reject]) => reject(err))
    }
  }

  /**
   * @ignore
   * @return {Promise<AMQPError>} Rejected promise with an error
   */
  rejectClosed() {
    return Promise.reject(new AMQPError("Channel is closed", this.connection))
  }

  /**
   * Called from AMQPBaseClient when a publish is confirmed by the server.
   * Will fulfill one or more (if multiple) Unconfirmed Publishes.
   * @ignore
   * @param {number} deliveryTag
   * @param {boolean} multiple - true if all unconfirmed publishes up to this deliveryTag should be resolved or just this one
   * @param {boolean} nack - true if negative confirm, hence reject the unconfirmed publish(es)
   */
  publishConfirmed(deliveryTag, multiple, nack) {
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
   */
  onMessageReady(message) {
    if (this.delivery) {
      this.delivery = null
      this.deliver(message)
    } else if (this.getMessage) {
      this.getMessage = null
      this.resolvePromise(message)
    } else {
      this.returned = null
      this.onReturn(message)
    }
  }

  /**
   * Deliver a message to a consumer
   * @ignore
   * @param {AMQPMessage} message
   * @return {Promise} Fulfilled when the message is processed
   */
  deliver(message) {
    queueMicrotask(() => {
      const consumer = this.consumers[message.consumerTag]
      if (consumer) {
        consumer.onMessage(message)
      } else {
        throw(new AMQPError(`Consumer ${message.consumerTag} on channel ${this.id} doesn't exists`, this.connection))
      }
    })
  }
}
