import AMQPView from './amqpview.mjs'

export default class AMQPClient {
  constructor() {
    this.channels = [0]
  }

  connect() {
    throw "Abstract method not implemented"
  }

  send() {
    throw "Abstract method not implemented"
  }

  closeSocket() {
    throw "Abstract method not implemented"
  }

  close({ code = 200, reason = "" } = {}) {
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(512))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, 0); j += 2 // channel: 0
    frame.setUint32(j, 0); j += 4 // frameSize
    frame.setUint16(j, 10); j += 2 // class: connection
    frame.setUint16(j, 50); j += 2 // method: close
    frame.setUint16(j, code); j += 2 // reply code
    j += frame.setShortString(j, reason) // reply reason
    frame.setUint16(j, 0); j += 2 // failing-class-id
    frame.setUint16(j, 0); j += 2 // failing-method-id
    frame.setUint8(j, 206); j += 1 // frame end byte
    frame.setUint32(3, j - 8) // update frameSize
    this.send(new Uint8Array(frame.buffer, 0, j))
  }

  channel(id) {
    return new Promise((resolve, reject) => {
      // Store channels in an array, set position to null when channel is closed
      // Look for first null value or add one the end
      if (!id)
        id = this.channels.findIndex((ch) => ch === undefined)
      if (id === -1) id = this.channels.length
      const channel = new AMQPChannel(this, id)
      this.channels[id] = channel
      channel.resolvePromise = () => resolve(channel)
      channel.rejectPromise = (err) => {
        console.log("ERRROR", err)
        delete this.channels[id]
        reject(err)
      }

      let j = 0
      const channelOpen = new AMQPView(new ArrayBuffer(13))
      channelOpen.setUint8(j, 1); j += 1 // type: method
      channelOpen.setUint16(j, id); j += 2 // channel: 1
      channelOpen.setUint32(j, 5); j += 4 // frameSize
      channelOpen.setUint16(j, 20); j += 2 // class: channel
      channelOpen.setUint16(j, 10); j += 2 // method: open
      channelOpen.setUint8(j, 0); j += 1 // reserved1
      channelOpen.setUint8(j, 206); j += 1 // frame end byte
      this.send(channelOpen.buffer)
    })
  }

  parseFrames(view) {
    // Can possibly be multiple AMQP frames in a single WS frame
    for (let i = 0; i < view.byteLength;) {
      let j = 0 // position in outgoing frame
      const type = view.getUint8(i); i += 1
      const channelId = view.getUint16(i); i += 2
      const frameSize = view.getUint32(i); i += 4
      switch (type) {
        case 1: { // method
          const classId = view.getUint16(i); i += 2
          const methodId = view.getUint16(i); i += 2
          switch (classId) {
            case 10: { // connection
              switch (methodId) {
                case 10: { // start
                  // ignore start frame, just reply startok
                  i += frameSize - 4

                  const startOk = new AMQPView(new ArrayBuffer(4096))
                  startOk.setUint8(j, 1); j += 1 // type: method
                  startOk.setUint16(j, 0); j += 2 // channel: 0
                  startOk.setUint32(j, 0); j += 4 // frameSize: to be updated
                  startOk.setUint16(j, 10); j += 2 // class: connection
                  startOk.setUint16(j, 11); j += 2 // method: startok
                  startOk.setUint32(j, 0); j += 4 // client properties
                  j += startOk.setShortString(j, "PLAIN") // mechanism
                  const response = "\u0000guest\u0000guest"
                  j += startOk.setLongString(j, response) // response
                  j += startOk.setShortString(j, "") // locale
                  startOk.setUint8(j, 206); j += 1 // frame end byte
                  startOk.setUint32(3, j - 8) // update frameSize
                  this.send(new Uint8Array(startOk.buffer, 0, j))
                  break
                }
                case 30: { // tune
                  const channelMax = view.getUint16(i); i += 2
                  const frameMax = view.getUint32(i); i += 4
                  const heartbeat = view.getUint16(i); i += 2
                  this.channelMax = channelMax
                  this.frameMax = Math.min(4096, frameMax)
                  this.heartbeat = Math.min(0, heartbeat)

                  const tuneOk = new AMQPView(new ArrayBuffer(20))
                  tuneOk.setUint8(j, 1); j += 1 // type: method
                  tuneOk.setUint16(j, 0); j += 2 // channel: 0
                  tuneOk.setUint32(j, 12); j += 4 // frameSize: 12
                  tuneOk.setUint16(j, 10); j += 2 // class: connection
                  tuneOk.setUint16(j, 31); j += 2 // method: tuneok
                  tuneOk.setUint16(j, this.channelMax); j += 2 // channel max
                  tuneOk.setUint32(j, this.frameMax); j += 4 // frame max
                  tuneOk.setUint16(j, this.heartbeat); j += 2 // heartbeat
                  tuneOk.setUint8(j, 206); j += 1 // frame end byte
                  this.send(new Uint8Array(tuneOk.buffer, 0, j))

                  j = 0
                  const open = new AMQPView(new ArrayBuffer(512))
                  open.setUint8(j, 1); j += 1 // type: method
                  open.setUint16(j, 0); j += 2 // channel: 0
                  open.setUint32(j, 0); j += 4 // frameSize: to be updated
                  open.setUint16(j, 10); j += 2 // class: connection
                  open.setUint16(j, 40); j += 2 // method: open
                  j += open.setShortString(j, "/") // vhost
                  open.setUint8(j, 0); j += 1 // reserved1
                  open.setUint8(j, 0); j += 1 // reserved2
                  open.setUint8(j, 206); j += 1 // frame end byte
                  open.setUint32(3, j - 8) // update frameSize
                  this.send(new Uint8Array(open.buffer, 0, j))

                  break
                }
                case 41: { // openok
                  i += 1 // reserved1
                  this.resolvePromise(this)
                  break
                }
                case 50: { // close
                  const code = view.getUint16(i); i += 2
                  const [text, strLen] = view.getShortString(i); i += strLen
                  const classId = view.getUint16(i); i += 2
                  const methodId = view.getUint16(i); i += 2
                  console.error("connection closed by server", code, text, classId, methodId)

                  const closeOk = new AMQPView(new ArrayBuffer(12))
                  closeOk.setUint8(j, 1); j += 1 // type: method
                  closeOk.setUint16(j, 0); j += 2 // channel: 0
                  closeOk.setUint32(j, 4); j += 4 // frameSize
                  closeOk.setUint16(j, 10); j += 2 // class: connection
                  closeOk.setUint16(j, 51); j += 2 // method: closeok
                  closeOk.setUint8(j, 206); j += 1 // frame end byte
                  this.send(new Uint8Array(closeOk.buffer, 0, j))
                  this.rejectPromise({code, text, classId, methodId})

                  this.closeSocket()
                  break
                }
                case 51: { // closeOk
                  this.closeSocket()
                  break
                }
                default:
                  i += frameSize - 4
                  console.error("unsupported method id", methodId)
              }
              break
            }
            case 20: { // channel
              switch (methodId) {
                case 11: { // openok
                  i += 4 // reserved1 (long string)
                  const channel = this.channels[channelId]
                  channel.resolvePromise(channelId)
                  break
                }
                case 40: { // close
                  const code = view.getUint16(i); i += 2
                  const [text, strLen] = view.getShortString(i); i += strLen
                  const classId = view.getUint16(i); i += 2
                  const methodId = view.getUint16(i); i += 2

                  console.warn("channel", channelId, "closed", code, text, classId, methodId)
                  const closeOk = new AMQPView(new ArrayBuffer(12))
                  closeOk.setUint8(j, 1); j += 1 // type: method
                  closeOk.setUint16(j, channelId); j += 2 // channel
                  closeOk.setUint32(j, 4); j += 4 // frameSize
                  closeOk.setUint16(j, 20); j += 2 // class: channel
                  closeOk.setUint16(j, 41); j += 2 // method: closeok
                  closeOk.setUint8(j, 206); j += 1 // frame end byte
                  this.send(new Uint8Array(closeOk.buffer, 0, j))

                  const channel = this.channels[channelId]
                  if (channel) {
                    console.log("rejecting promise", channel.rejectPromise)
                    channel.rejectPromise({code, text, classId, methodId})
                    delete this.channels[channelId]
                  } else {
                    console.warn("Channel", channelId, "already closed")
                  }

                  break
                }
                default:
                  i += frameSize - 4 // skip rest of frame
                  console.error("unsupported method id", methodId)
              }
              break
            }
            case 50: { // queue
              switch (methodId) {
                case 11: { // declareOk
                  const [name, strLen] = view.getShortString(i); i += strLen
                  const messageCount = view.getUint32(i); i += 4
                  const consumerCount = view.getUint32(i); i += 4
                  const channel = this.channels[channelId]
                  channel.resolvePromise({ name, messageCount, consumerCount })
                  break
                }
                case 21: { // bindOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
                case 31: { // purgeOk
                  const messageCount = view.getUint32(i); i += 4
                  const channel = this.channels[channelId]
                  channel.resolvePromise({ messageCount })
                  break
                }
                case 41: { // deleteOk
                  const messageCount = view.getUint32(i); i += 4
                  const channel = this.channels[channelId]
                  channel.resolvePromise({ messageCount })
                  break
                }
                case 51: { // unbindOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
                default:
                  i += frameSize - 4
                  console.error("unsupported method id", methodId)
              }
              break
            }
            case 60: { // basic
              switch (methodId) {
                case 11: { // qosOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
                case 31: { // cancelOk
                  const [consumerTag, len] = view.getShortString(i); i += len
                  const channel = this.channels[channelId]
                  channel.resolvePromise({ consumerTag })
                  break
                }
                case 60: { // deliver
                  const [ consumerTag, consumerTagLen ] = view.getShortString(i); i += consumerTagLen
                  const deliveryTag = view.getUint64(i); i += 8
                  const redeliviered = view.getUint8(i) === 1; i += 1
                  const [ exchange, exchangeLen ]= view.getShortString(i); i += exchangeLen
                  const [ routingKey, routingKeyLen ]= view.getShortString(i); i += routingKeyLen
                  const channel = this.channels[channelId]
                  if (!channel) {
                    console.warn("Cannot deliver to closed channel", channelId)
                    return
                  }
                  const message = new AMQPMessage(channel)
                  message.consumerTag = consumerTag
                  message.deliveryTag = deliveryTag
                  message.exchange = exchange
                  message.routingKey = routingKey
                  message.redeliviered = redeliviered
                  channel.delivery = message
                  break
                }
                default:
                  i += frameSize - 4
                  console.error("unsupported method id", methodId)
              }
              break
            }
            case 85: { // confirm
              switch (methodId) {
                case 11: { // selectOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
              }
              break
            }
            default:
              i += frameSize - 2
              console.error("unsupported class id", classId)
          }
          break
        }
        case 2: { // header
          i += 2 // ignoring class id
          i += 2 // ignoring weight
          const bodySize = view.getUint64(i); i += 8
          const [properties, propLen] = view.getProperties(i); i += propLen

          const channel = this.channels[channelId]
          if (!channel) {
            console.warn("Cannot deliver to closed channel", channelId)
            break
          }
          const delivery = channel.delivery
          delivery.bodySize = bodySize
          delivery.properties = properties
          delivery.body = new Uint8Array(bodySize)
          delivery.bodyPos = 0 // if body is split over multiple frames
          if (bodySize === 0)
            channel.deliver()
          break
        }
        case 3: { // body
          const channel = this.channels[channelId]
          if (!channel) {
            console.warn("Cannot deliver to closed channel", channelId)
            break
          }
          const delivery = channel.delivery
          const bodyPart = new Uint8Array(view.buffer, i, frameSize)
          delivery.body.set(bodyPart, delivery.bodyPos)
          delivery.bodyPos += frameSize
          i += frameSize
          if (delivery.bodyPos === delivery.bodySize)
            channel.deliver()
          break
        }
        case 8: { // heartbeat
          const heartbeat = new AMQPView(new ArrayBuffer(8))
          heartbeat.setUint8(j, 1); j += 1 // type: method
          heartbeat.setUint16(j, 0); j += 2 // channel: 0
          heartbeat.setUint32(j, 0); j += 4 // frameSize
          heartbeat.setUint8(j, 206); j += 1 // frame end byte
          this.send(new Uint8Array(heartbeat.buffer, 0, j))
          break
        }
        default:
          console.error("invalid frame type:", type)
          i += frameSize
      }
      const frameEnd = view.getUint8(i); i += 1
      if (frameEnd != 206)
        console.error("Invalid frame end", frameEnd)
    }
  }
}

class AMQPChannel {
  constructor(connection, id) {
    this.connection = connection
    this.id = id
    this.consumers = []
  }

  close() {
    throw "Not yet implemented"
  }

  // Message is ready to be delivered to consumer
  deliver() {
    const d = this.delivery
    delete d.bodyPos
    const c = this.consumers[d.consumerTag]
    this.delivery = null
    if (c)
      c(d)
    else
      console.error("Consumer", d.consumerTag, "on channel", this.id, "doesn't exists")
  }

  queueBind(queue, exchange, routingKey, noWait = false, args = {}) {
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
    this.connection.send(new Uint8Array(bind.buffer, 0, j))
    return new Promise((resolve, reject) => {
      noWait ? resolve(this) : this.resolvePromise = () => resolve(this)
      this.rejectPromise = reject
    })
  }

  queueUnbind(queue, exchange, routingKey, args = {}) {
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
    this.connection.send(new Uint8Array(unbind.buffer, 0, j))
    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  queuePurge(queue, noWait = true) {
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
    this.connection.send(new Uint8Array(purge.buffer, 0, j))
    return new Promise((resolve, reject) => {
      noWait ? resolve(this) : this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  queueDeclare({name = "", passive = false, durable = name !== "", autoDelete = name === "", exclusive = name === "", noWait = false}) {
    let j = 0
    const declare = new AMQPView(new ArrayBuffer(4096))
    declare.setUint8(j, 1); j += 1 // type: method
    declare.setUint16(j, 1); j += 2 // channel: 1
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
    j += declare.setTable(j, {}) // arguments
    declare.setUint8(j, 206); j += 1 // frame end byte
    declare.setUint32(3, j - 8) // update frameSize
    this.connection.send(new Uint8Array(declare.buffer, 0, j))

    return new Promise((resolve, reject) => {
      noWait ? resolve() : this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  queueDelete({ name = "", ifUnused = false, ifEmpty = false, noWait = false }) {
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(512))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, 1); j += 2 // channel: 1
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
    this.connection.send(new Uint8Array(frame.buffer, 0, j))

    return new Promise((resolve, reject) => {
      noWait ? resolve() : this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  basicQos(prefetchCount, prefetchSize = 0, global = false) {
    let j = 0
    const frame = new AMQPView(new ArrayBuffer(19))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, 1); j += 2 // channel: 1
    frame.setUint32(j, 11); j += 4 // frameSize
    frame.setUint16(j, 60); j += 2 // class: basic
    frame.setUint16(j, 10); j += 2 // method: qos
    frame.setUint31(j, prefetchSize); j += 4 // prefetch size
    frame.setUint16(j, prefetchCount); j += 2 // prefetch count
    frame.setUint8(j, global ? 1 : 0); j += 1 // glocal
    frame.setUint8(j, 206); j += 1 // frame end byte
    this.connection.send(new Uint8Array(frame.buffer, 0, 19))
    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  basicConsume(queue, { noAck = true, exclusive = false, noWait = true, args = {} }, callback) {
    const tag = this.consumers.length.toString()
    this.consumers.push(callback)

    let j = 0
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
    this.connection.send(new Uint8Array(frame.buffer, 0, j))

    return new Promise((resolve, reject) => {
      noWait ? resolve() : this.resolvePromise = resolve
      this.rejectPromise = (err) => {
        delete this.consumers[tag]
        reject(err)
      }
    })
  }

  basicCancel(tag, noWait = false) {
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
    this.connection.send(new Uint8Array(frame.buffer, 0, j))

    return new Promise((resolve, reject) => {
      delete this.consumers[tag]
      noWait ? resolve() : this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }

  basicAck(deliveryTag, multiple = false) {
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
    this.connection.send(new Uint8Array(frame.buffer, 0, 21))
  }

  basicReject(deliveryTag, requeue = false) {
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
    this.connection.send(new Uint8Array(frame.buffer, 0, 21))
  }

  basicNack(deliveryTag, requeue = false, multiple = false) {
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
    this.connection.send(new Uint8Array(frame.buffer, 0, 21))
  }

  basicPublish(exchange, routingkey, data, properties) {
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
      this.connection.send(new Uint8Array(buffer.buffer, 0, j))
      return
    }

    // Send current frames if a body frame can't fit in the rest of the frame buffer
    if (j >= 4096 - 8) {
      this.connection.send(new Uint8Array(buffer.buffer, 0, j))
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
      this.connection.send(new Uint8Array(buffer.buffer, 0, j))
      bodyPos += frameSize
      j = 0
    }
    return Promise.resolve(this)
  }

  confirmSelect(noWait = false) {
    let j = 0
    let frame = new AMQPView(new ArrayBuffer(13))
    frame.setUint8(j, 1); j += 1 // type: method
    frame.setUint16(j, this.id); j += 2 // channel
    frame.setUint32(j, 5) // frame size
    frame.setUint16(j, 85); j += 2 // class: confirm
    frame.setUint16(j, 10); j += 2 // method: select
    frame.setUint8(j, noWait ? 1 : 0); j += 1 // no wait
    frame.setUint8(j, 206); j += 1 // frame end byte
    this.connection.send(new Uint8Array(frame.buffer, 0, j))
    
    return new Promise((resolve, reject) => {
      noWait ? resolve(this) : this.resolvePromise = resolve
      this.rejectPromise = reject
    })
  }
  queue(name) {
    return new Promise((resolve, reject) => {
      this.rejectPromise = reject
      this.queueDeclare({name}).then(({name}) => resolve(new AMQPQueue(this, name)))
    })
  }
}

class AMQPQueue {
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
        .then(() => resolve(this))
        .catch(reject)
    })
  }

  unsubscribe(consumerId) {
    return new Promise((resolve, reject) => {
      this.channel.basicCancel(consumerId)
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
}

class AMQPMessage {
  constructor(channel) {
    this.channel = channel
  }

  bodyString() {
    const decoder = new TextDecoder()
    return decoder.decode(this.body)
  }

  ack() {
    return this.channel.basicAck(this.deliveryTag)
  }

  nack() {
    return this.channel.basicNack(this.deliveryTag)
  }
}
