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

  openChannel() {
    // Store channels in an array, set position to null when channel is closed
    // Look for first null value or add one the end
    let id = this.channels.findIndex((ch) => ch === null)
    if (id === -1) id = this.channels.length
    const channel = new AMQPChannel(this, id)
    this.channels[id] = channel

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
    return new Promise((resolv, reject) => {
      channel.resolvPromise = () => resolv(channel)
      channel.rejectPromise = (err) => {
        this.channels[id] = null
        reject(err)
      }
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
                  this.frameMax = frameMax
                  this.heartbeat = heartbeat

                  const tuneOk = new AMQPView(new ArrayBuffer(20))
                  tuneOk.setUint8(j, 1); j += 1 // type: method
                  tuneOk.setUint16(j, 0); j += 2 // channel: 0
                  tuneOk.setUint32(j, 12); j += 4 // frameSize: 12
                  tuneOk.setUint16(j, 10); j += 2 // class: connection
                  tuneOk.setUint16(j, 31); j += 2 // method: tuneok
                  tuneOk.setUint16(j, channelMax); j += 2 // channel max
                  tuneOk.setUint32(j, 4096); j += 4 // frame max
                  tuneOk.setUint16(j, 0); j += 2 // heartbeat
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
                  this.resolvPromise(this)
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
                  channel.resolvPromise(channelId)
                  break
                }
                case 40: { // close
                  const code = view.getUint16(i); i += 2
                  const [text, strLen] = view.getShortString(i); i += strLen
                  const classId = view.getUint16(i); i += 2
                  const methodId = view.getUint16(i); i += 2

                  const closeOk = new AMQPView(new ArrayBuffer(12))
                  closeOk.setUint8(j, 1); j += 1 // type: method
                  closeOk.setUint16(j, channelId); j += 2 // channel
                  closeOk.setUint32(j, 4); j += 4 // frameSize
                  closeOk.setUint16(j, 20); j += 2 // class: channel
                  closeOk.setUint16(j, 41); j += 2 // method: closeok
                  closeOk.setUint8(j, 206); j += 1 // frame end byte
                  this.send(new Uint8Array(closeOk.buffer, 0, j))

                  const channel = this.channels[channelId]
                  channel.rejectPromise({code, text, classId, methodId})
                  this.channels[channelId] = null

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
                  const [queueName, strLen] = view.getShortString(i); i += strLen
                  const messageCount = view.getUint32(i); i += 4
                  const consumerCount = view.getUint32(i); i += 4
                  const channel = this.channels[channelId]
                  channel.resolvPromise({name: queueName, messages: messageCount, consumers: consumerCount})
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
                case 60: { // deliver
                  const [ consumerTag, consumerTagLen ] = view.getShortString(i); i += consumerTagLen
                  const deliveryTag = view.getUint64(i); i += 8
                  const redeliviered = view.getUint8(i) === 1; i += 1
                  const [ exchange, exchangeLen ]= view.getShortString(i); i += exchangeLen
                  const [ routingKey, routingKeyLen ]= view.getShortString(i); i += routingKeyLen
                  const channel = this.channels[channelId]
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
    const c = this.consumers[d.consumerTag]
    this.delivery = null
    if (c)
      c(d)
    else
      console.error("Consumer", d.consumerTag, "on channel", this.id, "doesn't exists")
  }

  queueBind(queue, exchange, routingKey, noWait = true, args = {}) {
    let j = 0
    const bind = new AMQPView(new ArrayBuffer(1024))
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
    return new Promise((resolv, reject) => {
      noWait ? resolv(this) : this.resolvPromise = resolv
      this.rejectPromise = reject
    })
  }

  queueDeclare({name = "", passive = false, durable = name !== "", autoDelete = name === "", exclusive = name === "", noWait = false}) {
    let j = 0
    const declare = new AMQPView(new ArrayBuffer(512))
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

    return new Promise((resolv, reject) => {
      noWait ? resolv() : this.resolvPromise = resolv
      this.rejectPromise = reject
    })
  }

  basicConsume(queue, { noAck = true, exclusive = false, noWait = true }, callback) {
    const tag = this.consumers.length.toString()
    this.consumers.push(callback)

    let j = 0
    const noLocal = false
    const frame = new AMQPView(new ArrayBuffer(1024))
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
    j += frame.setTable(j, {}) // arguments table
    frame.setUint8(j, 206); j += 1 // frame end byte
    frame.setUint32(3, j - 8) // update frameSize
    this.connection.send(new Uint8Array(frame.buffer, 0, j))

    return new Promise((resolv, reject) => {
      noWait ? resolv() : this.resolvPromise = resolv
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
  }

  queue(name) {
    return new Promise((resolv, reject) => {
      this.rejectPromise = reject
      this.queueDeclare({name}).then(({name, messages, consumers}) => {
        resolv(new AMQPQueue(this, name))
      })
    })
  }
}

class AMQPQueue {
  constructor(channel, name) {
    this.channel = channel
    this.name = name
  }

  bind(exchange, routingkey) {
    this.channel.queueBind(this.name, exchange, routingkey)
    return this
  }

  publish(body) {
    this.channel.basicPublish("", this.name, body)
    return this
  }

  subscribe({noAck = true, exclusive = false}, callback) {
    this.channel.basicConsume(this.name, {noAck, exclusive}, callback)
    return this
  }

  unsubscribe(consumerId) {
    this.channel.basicCancel(consumerId)
    return this
  }

  delete() {
    this.channel.queueDelete(this.name)
    return this
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
