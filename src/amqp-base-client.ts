import AMQPChannel from './amqp-channel'
import AMQPError from './amqp-error'
import AMQPMessage from './amqp-message'
import AMQPView from './amqp-view'

const VERSION = '1.2.2'

/**
 * Base class for AMQPClients.
 * Implements everything except how to connect, send data and close the socket
 */
export default abstract class AMQPBaseClient {
  vhost: string
  username: string
  password: string
  name?: string
  platform?: string
  channels: AMQPChannel[]
  connectPromise?: [(conn: AMQPBaseClient) => void, (err: Error) => void]
  closePromise?: [(value?: any) => void, (err: Error) => void]
  closed = false
  blocked?: string
  channelMax = 0
  frameMax = 16384
  heartbeat = 0
  /**
   * @param {string} vhost
   * @param {string} username
   * @param {string} password
   * @param {string?} name - name of the connection, set in client properties
   * @param {string} platform - used in client properties
   */
  constructor(vhost: string, username: string, password: string, name?: string, platform?: string) {
    this.vhost = vhost
    this.username = username
    this.password = ""
    Object.defineProperty(this, 'password', {
      value: password,
      enumerable: false // hide it from console.log etc.
    })
    this.name = name // connection name
    this.platform = platform
    this.channels = [new AMQPChannel(this, 0)]
    this.closed = false
  }

  /**
   * Open a channel
   * @param {number} [id] - An existing or non existing specific channel
   * @return {Promise<AMQPChannel>} channel
   */
  channel(id: number): Promise<AMQPChannel> {
    if (this.closed) return this.rejectClosed()
    if (id && id > 0 && this.channels[id]) return Promise.resolve(this.channels[id])
    // Store channels in an array, set position to null when channel is closed
    // Look for first null value or add one the end
    if (!id)
      id = this.channels.findIndex((ch) => ch === undefined)
    if (id === -1) id = this.channels.length
    const channel = new AMQPChannel(this, id)
    this.channels[id] = channel

    let j = 0
    const channelOpen = new AMQPView(new ArrayBuffer(13))
    channelOpen.setUint8(j, 1); j += 1 // type: method
    channelOpen.setUint16(j, id); j += 2 // channel id
    channelOpen.setUint32(j, 5); j += 4 // frameSize
    channelOpen.setUint16(j, 20); j += 2 // class: channel
    channelOpen.setUint16(j, 10); j += 2 // method: open
    channelOpen.setUint8(j, 0); j += 1 // reserved1
    channelOpen.setUint8(j, 206); j += 1 // frame end byte
    return new Promise((resolve, reject) => {
      this.send(new Uint8Array(channelOpen.buffer, 0, 13))
        .then(() => channel.promises.push([resolve, reject]))
        .catch(reject)
    })
  }

  /**
   * Gracefully close the AMQP connection
   * @param {object} params
   * @param {number} [params.code=200] - Close code
   * @param {string} [params.reason=""] - Reason for closing the connection
   */
  close({ code = 200, reason = "" } = {}) {
    if (this.closed) return this.rejectClosed()
    this.closed = true
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
    return new Promise((resolve, reject) => {
      this.send(new Uint8Array(frame.buffer, 0, j))
        .then(() => this.closePromise = [resolve, reject])
        .catch(reject)
    })
  }

  /**
   * @abstract
   * @return {Promise<AMQPBaseClient>}
   */
  abstract connect(): Promise<AMQPBaseClient>

  /**
   * @abstract
   * @ignore
   * @param {Uint8Array} bytes to send
   * @return {Promise<void>} fulfilled when the data is enqueued
   */
  abstract send(bytes: Uint8Array): Promise<void>

  /**
   * @protected
   */
  abstract closeSocket(): void

  /** @private */
  rejectClosed() {
    return Promise.reject(new AMQPError("Connection closed", this))
  }

  /** @private
   * @param {Error} err
   */
  rejectConnect(err: Error) {
    if (this.connectPromise) {
      const [, reject] = this.connectPromise
      delete this.connectPromise
      reject(err)
    }
    this.closed = true
    this.closeSocket()
  }

  /**
   * Parse and act on frames in an AMQPView
   * @param {AMQPView} view over a ArrayBuffer
   * @ignore
   */
  parseFrames(view: AMQPView) {
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
                  const clientProps = {
                    connection_name: this.name || undefined,
                    product: "amqp-client.js",
                    information: "https://github.com/cloudamqp/amqp-client.js",
                    version: VERSION,
                    platform: this.platform,
                    capabilities: {
                      "authentication_failure_close": true,
                      "basic.nack": true,
                      "connection.blocked": false,
                      "consumer_cancel_notify": true,
                      "exchange_exchange_bindings": true,
                      "per_consumer_qos": true,
                      "publisher_confirms": true,
                    }
                  }
                  j += startOk.setTable(j, clientProps) // client properties
                  j += startOk.setShortString(j, "PLAIN") // mechanism
                  const response = `\u0000${this.username}\u0000${this.password}`
                  j += startOk.setLongString(j, response) // response
                  j += startOk.setShortString(j, "") // locale
                  startOk.setUint8(j, 206); j += 1 // frame end byte
                  startOk.setUint32(3, j - 8) // update frameSize
                  this.send(new Uint8Array(startOk.buffer, 0, j)).catch(this.rejectConnect)
                  break
                }
                case 30: { // tune
                  const channelMax = view.getUint16(i); i += 2
                  const frameMax = view.getUint32(i); i += 4
                  const heartbeat = view.getUint16(i); i += 2
                  this.channelMax = channelMax
                  this.frameMax = Math.min(16384, frameMax)
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
                  this.send(new Uint8Array(tuneOk.buffer, 0, j)).catch(this.rejectConnect)

                  j = 0
                  const open = new AMQPView(new ArrayBuffer(512))
                  open.setUint8(j, 1); j += 1 // type: method
                  open.setUint16(j, 0); j += 2 // channel: 0
                  open.setUint32(j, 0); j += 4 // frameSize: to be updated
                  open.setUint16(j, 10); j += 2 // class: connection
                  open.setUint16(j, 40); j += 2 // method: open
                  j += open.setShortString(j, this.vhost) // vhost
                  open.setUint8(j, 0); j += 1 // reserved1
                  open.setUint8(j, 0); j += 1 // reserved2
                  open.setUint8(j, 206); j += 1 // frame end byte
                  open.setUint32(3, j - 8) // update frameSize
                  this.send(new Uint8Array(open.buffer, 0, j)).catch(this.rejectConnect)

                  break
                }
                case 41: { // openok
                  i += 1 // reserved1
                  const promise  = this.connectPromise
                  if (promise) {
                    const [resolve, ] = promise
                    delete this.connectPromise
                    resolve(this)
                  }
                  break
                }
                case 50: { // close
                  const code = view.getUint16(i); i += 2
                  const [text, strLen] = view.getShortString(i); i += strLen
                  const classId = view.getUint16(i); i += 2
                  const methodId = view.getUint16(i); i += 2
                  console.debug("connection closed by server", code, text, classId, methodId)

                  const msg = `connection closed: ${text} (${code})`
                  const err = new AMQPError(msg, this)
                  this.channels.forEach((ch) => ch.setClosed(err))
                  this.channels = [new AMQPChannel(this, 0)]

                  const closeOk = new AMQPView(new ArrayBuffer(12))
                  closeOk.setUint8(j, 1); j += 1 // type: method
                  closeOk.setUint16(j, 0); j += 2 // channel: 0
                  closeOk.setUint32(j, 4); j += 4 // frameSize
                  closeOk.setUint16(j, 10); j += 2 // class: connection
                  closeOk.setUint16(j, 51); j += 2 // method: closeok
                  closeOk.setUint8(j, 206); j += 1 // frame end byte
                  this.send(new Uint8Array(closeOk.buffer, 0, j))
                    .catch(err => console.warn("Error while sending Connection#CloseOk", err))
                  this.rejectConnect(err)
                  break
                }
                case 51: { // closeOk
                  this.channels.forEach((ch) => ch.setClosed())
                  this.channels = [new AMQPChannel(this, 0)]
                  const promise = this.closePromise
                  if (promise) {
                    const [resolve, ] = promise
                    delete this.closePromise
                    resolve()
                    this.closeSocket()
                  }
                  break
                }
                case 60: { // blocked
                  const [reason, len] = view.getShortString(i); i += len
                  this.blocked = reason
                  break
                }
                case 61: { // unblocked
                  this.blocked = undefined
                  break
                }
                default:
                  i += frameSize - 4
                  console.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case 20: { // channel
              switch (methodId) {
                case 11: { // openok
                  i += 4 // reserved1 (long string)
                  const channel = this.channels[channelId]
                  channel.resolvePromise(channel)
                  break
                }
                case 21: { // flowOk
                  const active = view.getUint8(i) !== 0; i += 1
                  const channel = this.channels[channelId]
                  channel.resolvePromise(active)
                  break
                }
                case 40: { // close
                  const code = view.getUint16(i); i += 2
                  const [text, strLen] = view.getShortString(i); i += strLen
                  const classId = view.getUint16(i); i += 2
                  const methodId = view.getUint16(i); i += 2
                  console.debug("channel", channelId, "closed", code, text, classId, methodId)

                  const channel = this.channels[channelId]
                  if (channel) {
                    const msg = `channel ${channelId} closed: ${text} (${code})`
                    const err = new AMQPError(msg, this)
                    channel.setClosed(err)
                    delete this.channels[channelId]
                  } else {
                    console.warn("channel", channelId, "already closed")
                  }

                  const closeOk = new AMQPView(new ArrayBuffer(12))
                  closeOk.setUint8(j, 1); j += 1 // type: method
                  closeOk.setUint16(j, channelId); j += 2 // channel
                  closeOk.setUint32(j, 4); j += 4 // frameSize
                  closeOk.setUint16(j, 20); j += 2 // class: channel
                  closeOk.setUint16(j, 41); j += 2 // method: closeok
                  closeOk.setUint8(j, 206); j += 1 // frame end byte
                  this.send(new Uint8Array(closeOk.buffer, 0, j))
                    .catch(err => console.error("Error while sending Channel#closeOk", err))
                  break
                }
                case 41: { // closeOk
                  const channel = this.channels[channelId]
                  if (channel) {
                    channel.setClosed()
                    delete this.channels[channelId]
                    channel.resolvePromise()
                  }
                  break
                }
                default:
                  i += frameSize - 4 // skip rest of frame
                  console.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case 40: { // exchange
              switch (methodId) {
                case 11: { // declareOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
                case 21: { // deleteOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
                case 31: { // bindOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
                case 51: { // unbindOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
                default:
                  i += frameSize - 4 // skip rest of frame
                  console.error("unsupported class/method id", classId, methodId)
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
                  console.error("unsupported class/method id", classId, methodId)
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
                case 21: { // consumeOk
                  const [ consumerTag, len ] = view.getShortString(i); i += len
                  const channel = this.channels[channelId]
                  channel.resolvePromise(consumerTag)
                  break
                }
                case 31: { // cancelOk
                  const [consumerTag, len] = view.getShortString(i); i += len
                  const channel = this.channels[channelId]
                  channel.resolvePromise(consumerTag)
                  break
                }
                case 50: { // return
                  const code = view.getUint16(i); i += 2
                  const [text, len] = view.getShortString(i); i += len
                  const [exchange, exchangeLen] = view.getShortString(i); i += exchangeLen
                  const [routingKey, routingKeyLen] = view.getShortString(i); i += routingKeyLen
                  const channel = this.channels[channelId]
                  if (!channel) {
                    console.warn("Cannot return to closed channel", channelId)
                    break
                  }
                  const message = new AMQPMessage(channel)
                  message.exchange = exchange
                  message.routingKey = routingKey
                  message.replyCode = code
                  message.replyText = text
                  channel.returned = message
                  break
                }
                case 60: { // deliver
                  const [consumerTag, consumerTagLen] = view.getShortString(i); i += consumerTagLen
                  const deliveryTag = view.getUint64(i); i += 8
                  const redelivered = view.getUint8(i) === 1; i += 1
                  const [exchange, exchangeLen] = view.getShortString(i); i += exchangeLen
                  const [routingKey, routingKeyLen] = view.getShortString(i); i += routingKeyLen
                  const channel = this.channels[channelId]
                  if (!channel) {
                    console.warn("Cannot deliver to closed channel", channelId)
                    break
                  }
                  const message = new AMQPMessage(channel)
                  message.consumerTag = consumerTag
                  message.deliveryTag = deliveryTag
                  message.exchange = exchange
                  message.routingKey = routingKey
                  message.redelivered = redelivered
                  channel.delivery = message
                  break
                }
                case 71: { // getOk
                  const deliveryTag = view.getUint64(i); i += 8
                  const redelivered = view.getUint8(i) === 1; i += 1
                  const [exchange, exchangeLen]= view.getShortString(i); i += exchangeLen
                  const [routingKey, routingKeyLen]= view.getShortString(i); i += routingKeyLen
                  const messageCount = view.getUint32(i); i += 4
                  const channel = this.channels[channelId]
                  if (!channel) {
                    console.warn("Cannot deliver to closed channel", channelId)
                    break
                  }
                  const message = new AMQPMessage(channel)
                  message.deliveryTag = deliveryTag
                  message.redelivered = redelivered
                  message.exchange = exchange
                  message.routingKey = routingKey
                  message.messageCount = messageCount
                  channel.getMessage = message
                  break
                }
                case 72: { // getEmpty
                  const [ , len]= view.getShortString(i); i += len // reserved1
                  const channel = this.channels[channelId]
                  channel.resolvePromise(null)
                  break
                }
                case 80: { // confirm ack
                  const deliveryTag = view.getUint64(i); i += 8
                  const multiple = view.getUint8(i) === 1; i += 1
                  const channel = this.channels[channelId]
                  if (!channel) {
                    console.warn("Got publish confirm ack for closed channel", channelId)
                    break
                  }
                  channel.publishConfirmed(deliveryTag, multiple, false)
                  break
                }
                case 111: { // recoverOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
                case 120: { // confirm nack
                  const deliveryTag = view.getUint64(i); i += 8
                  const multiple = view.getUint8(i) === 1; i += 1
                  const channel = this.channels[channelId]
                  if (!channel) {
                    console.warn("Got publish confirm nack for closed channel", channelId)
                    break
                  }
                  channel.publishConfirmed(deliveryTag, multiple, true)
                  break
                }
                default:
                  i += frameSize - 4
                  console.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case 85: { // confirm
              switch (methodId) {
                case 11: { // selectOk
                  const channel = this.channels[channelId]
                  channel.confirmId = 1
                  channel.resolvePromise()
                  break
                }
                default:
                  i += frameSize - 4
                  console.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case 90: { // tx / transaction
              switch (methodId) {
                case 11: // selectOk
                case 21: // commitOk
                case 31: { // rollbackOk
                  const channel = this.channels[channelId]
                  channel.resolvePromise()
                  break
                }
                default:
                  i += frameSize - 4
                  console.error("unsupported class/method id", classId, methodId)
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
          const channel = this.channels[channelId]
          if (!channel) {
            console.warn("Cannot deliver to closed channel", channelId)
            i += frameSize
            break
          }

          i += 4 // ignoring class id and weight
          const bodySize = view.getUint64(i); i += 8
          const [properties, propLen] = view.getProperties(i); i += propLen
          const message = channel.delivery || channel.getMessage || channel.returned
          if (message) {
            message.bodySize = bodySize
            message.properties = properties
            message.body = new Uint8Array(bodySize)
            if (bodySize === 0)
              channel.onMessageReady(message)
          } else {
            console.warn("Header frame but no message")
          }
          break
        }
        case 3: { // body
          const channel = this.channels[channelId]
          if (!channel) {
            console.warn("Cannot deliver to closed channel", channelId)
            i += frameSize
            break
          }
          const message = channel.delivery || channel.getMessage || channel.returned
          if (message && message.body) {
            const bodyPart = new Uint8Array(view.buffer, view.byteOffset + i, frameSize)
            message.body.set(bodyPart, message.bodyPos)
            message.bodyPos += frameSize
            i += frameSize
            if (message.bodyPos === message.bodySize)
              channel.onMessageReady(message)
          }
          break
        }
        case 8: { // heartbeat
          const heartbeat = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 206])
          this.send(heartbeat).catch(err => console.warn("Error while sending heartbeat", err))
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
