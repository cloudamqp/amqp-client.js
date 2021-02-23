import AMQPError from './amqp-error.mjs'
import AMQPQueue from './amqp-queue.mjs'
import AMQPView from './amqp-view.mjs'
import AMQPConsumer from './amqp-consumer.mjs'

export default class AMQPChannel {
  constructor(connection, id) {
    this.connection = connection
    this.id = id
    this.consumers = {}
    this.closed = false
  }

  setClosed(err) {
    if (!this.closed) {
      this.closed = true
      // Close all consumers
      Object.values(this.consumers).forEach((consumer) => consumer.setClosed(err))
      this.consumers = [] // Empty consumers
      if (this.rejectPromise) this.rejectPromise(err) // Reject if waiting for a RPC command
    }
  }

  rejectClosed() {
    return Promise.reject(new AMQPError("Channel is closed", this.connection))
  }

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
    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(frame.buffer, 0, j)).catch(reject)
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  // Message is ready to be delivered to consumer
  deliver() {
    const d = this.delivery
    this.delivery = null
    delete d.bodyPos
    const consumer = this.consumers[d.consumerTag]
    if (consumer)
      consumer.onMessage(d)
    else
      console.error("Consumer", d.consumerTag, "on channel", this.id, "doesn't exists")
  }

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
    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(bind.buffer, 0, j)).catch(reject)
      this.resolvePromise = () => resolve(this)
      this.rejectPromise = reject
    })
  }

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
    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(unbind.buffer, 0, j)).catch(reject)
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

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
    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(purge.buffer, 0, j)).catch(reject)
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  queueDeclare(name = "", {passive = false, durable = name !== "", autoDelete = name === "", exclusive = name === "", args = {}} = {}) {
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

    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(declare.buffer, 0, j)).catch(reject)
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

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

    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(frame.buffer, 0, j)).catch(reject)
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  basicQos(prefetchCount, prefetchSize = 0, global = false) {
    if (this.closed) return this.rejectClosed()
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(19))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel: 1
    frame.setUint32(j, 11); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 10); j += 2 // method: qos
    frame.setUint31(j, prefetchSize); j += 4 // prefetch size
    frame.setUint16(j, prefetchCount); j += 2 // prefetch count
    frame.setUint8(j, global ? 1 : 0); j += 1 // glocal
    frame.setUint8(j, 206); j += 1 // frame end byte
    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(frame.buffer, 0, j)).catch(reject)
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

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
      this.connection.send(new Uint8Array(frame.buffer, 0, j)).catch(reject)
      this.resolvePromise = (consumerTag) => {
        const consumer = new AMQPConsumer(this, consumerTag, callback)
        this.consumers[consumerTag] = consumer
        resolve(consumer)
      }
      this.rejectPromise = reject
    })
  }

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
      this.connection.send(new Uint8Array(frame.buffer, 0, j)).catch(reject)
      this.resolvePromise = (consumerTag) => {
        const consumer = this.consumers[consumerTag]
        consumer.setClosed()
        delete this.consumers[consumerTag]
        resolve(this)
      }
      this.rejectPromise = reject
    })
  }

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

  basicPublish(exchange, routingkey, data, properties) {
    if (this.closed) return this.rejectClosed()
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
    let buffer = new AMQPView(new ArrayBuffer(4096))
    buffer.setUint8(j, 1); j += 1 // type: method
    buffer.setUint16(j, this.id); j += 2 // channel
    j += 4 // frame size, update later
    buffer.setUint16(j, 60); j += 2 // class: basic
    buffer.setUint16(j, 40); j += 2 // method: publish
    buffer.setUint16(j, 0); j += 2 // reserved1
    j += buffer.setShortString(j, exchange) // exchange
    j += buffer.setShortString(j, routingkey) // routing key
    buffer.setUint8(j, 0); j += 1 // mandatory/immediate
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
      return
    }

    // Send current frames if a body frame can't fit in the rest of the frame buffer
    if (j >= 4096 - 8) {
      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j))
      promises.push(p)
      j = 0
    }

    // split body into multiple frames if body > frameMax
    for (let bodyPos = 0; bodyPos < data.byteLength;) {
      const frameSize = Math.min(data.byteLength - bodyPos, 4096 - 8 - j) // frame overhead is 8 bytes
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
    return Promise.all(promises)
  }

  confirmSelect() {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    let j = 0
    let frame = new AMQPView(new ArrayBuffer(13))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 5) // frame size
    frame.setUint16(j, 85); j += 2 // class: confirm
    frame.setUint16(j, 10); j += 2 // method: select
    frame.setUint8(j, noWait ? 1 : 0); j += 1 // no wait
    frame.setUint8(j, 206); j += 1 // frame end byte
    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(frame.buffer, 0, j)).catch(reject)
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  queue(name = "", props = {}) {
    return new Promise((resolve, reject) => {
      this.queueDeclare(name, props)
        .then(({name}) => resolve(new AMQPQueue(this, name)))
        .catch(reject)
    })
  }

  prefetch(prefetchCount) {
    return this.basicQos(prefetchCount)
  }
}
