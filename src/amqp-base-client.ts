import { AMQPChannel } from './amqp-channel.js'
import { AMQPError } from './amqp-error.js'
import { AMQPMessage } from './amqp-message.js'
import { AMQPView } from './amqp-view.js'

const VERSION = '2.1.1'

/**
 * Base class for AMQPClients.
 * Implements everything except how to connect, send data and close the socket
 */
export abstract class AMQPBaseClient {
  vhost: string
  username: string
  password: string
  name?: string
  platform?: string
  channels: AMQPChannel[]
  protected connectPromise?: [(conn: AMQPBaseClient) => void, (err: Error) => void]
  protected closePromise?: [(value?: void) => void, (err: Error) => void]
  closed = true
  blocked?: string
  channelMax = 0
  frameMax: number
  heartbeat: number
  onerror: (error: AMQPError) => void
  /** Used for string -> arraybuffer when publishing */
  readonly textEncoder = new TextEncoder()
  // Buffer pool for publishes, let multiple microtasks publish at the same time but save on allocations
  readonly bufferPool: AMQPView[] = []

  /**
   * @param name - name of the connection, set in client properties
   * @param platform - used in client properties
   */
  constructor(vhost: string, username: string, password: string, name?: string, platform?: string, frameMax = 4096, heartbeat = 0) {
    this.vhost = vhost
    this.username = username
    this.password = ""
    Object.defineProperty(this, 'password', {
      value: password,
      enumerable: false // hide it from console.log etc.
    })
    if (name) this.name = name // connection name
    if (platform) this.platform = platform
    this.channels = [new AMQPChannel(this, 0)]
    this.onerror = (error: AMQPError) => console.error("amqp-client connection closed", error.message)
    if (frameMax < 4096) throw new Error("frameMax must be 4096 or larger")
    this.frameMax = frameMax
    if (heartbeat < 0) throw new Error("heartbeat must be positive")
    this.heartbeat = heartbeat
  }

  /**
   * Open a channel
   * @param [id] - An existing or non existing specific channel
   */
  channel(id?: number): Promise<AMQPChannel> {
    if (this.closed) return this.rejectClosed()
    if (id && id > 0) {
      const channel = this.channels[id]
      if (channel) return Promise.resolve(channel)
    }
    // Store channels in an array, set position to null when channel is closed
    // Look for first null value or add one the end
    if (!id)
      id = this.channels.findIndex((ch) => ch === undefined)
    if (id === -1) id = this.channels.length
    // FIXME: check max channels (or let the server deal with that?)
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
   * @param [reason] might be logged by the server
   */
  close(reason = "", code = 200): Promise<void> {
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
   * Try establish a connection
   */
  abstract connect(): Promise<AMQPBaseClient>

  /**
   * @ignore
   * @param bytes to send
   * @return fulfilled when the data is enqueued
   */
  abstract send(bytes: Uint8Array): Promise<void>

  protected abstract closeSocket(): void

  private rejectClosed() {
    return Promise.reject(new AMQPError("Connection closed", this))
  }

  private rejectConnect(err: Error): void {
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
   * @ignore
   */
  protected parseFrames(view: AMQPView): void {
    // Can possibly be multiple AMQP frames in a single WS frame
    for (let i = 0; i < view.byteLength;) {
      let j = 0 // position in outgoing frame
      const type = view.getUint8(i); i += 1
      const channelId = view.getUint16(i); i += 2
      const frameSize = view.getUint32(i); i += 4
      try {
        const frameEnd = view.getUint8(i + frameSize)
        if (frameEnd !== 206)
          throw(new AMQPError(`Invalid frame end ${frameEnd}, expected 206`, this))
      } catch (e) {
        throw(new AMQPError(`Frame end out of range, frameSize=${frameSize}, pos=${i}, byteLength=${view.byteLength}`, this))
      }

      const channel = this.channels[channelId]
      if (!channel) {
        console.warn("AMQP channel", channelId, "not open")
        i += frameSize + 1
        continue
      }
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
                      "connection.blocked": true,
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
                  this.frameMax = this.frameMax === 0 ? frameMax : Math.min(this.frameMax, frameMax)
                  this.heartbeat = this.heartbeat === 0 ? 0 : Math.min(this.heartbeat, heartbeat)

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
                  this.closed = false
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
                  this.onerror(err)
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
                  console.warn("AMQP connection blocked:", reason)
                  this.blocked = reason
                  break
                }
                case 61: { // unblocked
                  console.info("AMQP connection unblocked")
                  delete this.blocked
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
                  channel.resolvePromise(channel)
                  break
                }
                case 21: { // flowOk
                  const active = view.getUint8(i) !== 0; i += 1
                  channel.resolvePromise(active)
                  break
                }
                case 40: { // close
                  const code = view.getUint16(i); i += 2
                  const [text, strLen] = view.getShortString(i); i += strLen
                  const classId = view.getUint16(i); i += 2
                  const methodId = view.getUint16(i); i += 2
                  console.debug("channel", channelId, "closed", code, text, classId, methodId)

                  const msg = `channel ${channelId} closed: ${text} (${code})`
                  const err = new AMQPError(msg, this)
                  channel.setClosed(err)
                  delete this.channels[channelId]

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
                  channel.setClosed()
                  delete this.channels[channelId]
                  channel.resolvePromise()
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
                case 11: // declareOk
                case 21: // deleteOk
                case 31: // bindOk
                case 51: { // unbindOk
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
                  channel.resolvePromise({ name, messageCount, consumerCount })
                  break
                }
                case 21: { // bindOk
                  channel.resolvePromise()
                  break
                }
                case 31: { // purgeOk
                  const messageCount = view.getUint32(i); i += 4
                  channel.resolvePromise({ messageCount })
                  break
                }
                case 41: { // deleteOk
                  const messageCount = view.getUint32(i); i += 4
                  channel.resolvePromise({ messageCount })
                  break
                }
                case 51: { // unbindOk
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
                  channel.resolvePromise()
                  break
                }
                case 21: { // consumeOk
                  const [consumerTag, len] = view.getShortString(i); i += len
                  channel.resolvePromise(consumerTag)
                  break
                }
                case 30: { // cancel
                  const [consumerTag, len] = view.getShortString(i); i += len
                  const noWait = view.getUint8(i) === 1; i += 1

                  const consumer = channel.consumers.get(consumerTag)
                  if (consumer) {
                    consumer.setClosed(new AMQPError("Consumer cancelled by the server", this))
                    channel.consumers.delete(consumerTag)
                  }
                  if (!noWait) {
                    const frame = new AMQPView(new ArrayBuffer(512))
                    frame.setUint8(j, 1); j += 1 // type: method
                    frame.setUint16(j, channel.id); j += 2 // channel
                    frame.setUint32(j, 0); j += 4 // frameSize
                    frame.setUint16(j, 60); j += 2 // class: basic
                    frame.setUint16(j, 31); j += 2 // method: cancelOk
                    j += frame.setShortString(j, consumerTag) // tag
                    frame.setUint8(j, 206); j += 1 // frame end byte
                    frame.setUint32(3, j - 8) // update frameSize
                    this.send(new Uint8Array(frame.buffer, 0, j))
                  }
                  break
                }
                case 31: { // cancelOk
                  const [consumerTag, len] = view.getShortString(i); i += len
                  channel.resolvePromise(consumerTag)
                  break
                }
                case 50: { // return
                  const code = view.getUint16(i); i += 2
                  const [text, len] = view.getShortString(i); i += len
                  const [exchange, exchangeLen] = view.getShortString(i); i += exchangeLen
                  const [routingKey, routingKeyLen] = view.getShortString(i); i += routingKeyLen
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
                  channel.resolvePromise(null)
                  break
                }
                case 80: { // confirm ack
                  const deliveryTag = view.getUint64(i); i += 8
                  const multiple = view.getUint8(i) === 1; i += 1
                  channel.publishConfirmed(deliveryTag, multiple, false)
                  break
                }
                case 111: { // recoverOk
                  channel.resolvePromise()
                  break
                }
                case 120: { // confirm nack
                  const deliveryTag = view.getUint64(i); i += 8
                  const multiple = view.getUint8(i) === 1; i += 1
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
          const message = channel.delivery || channel.getMessage || channel.returned
          if (message && message.body) {
            const bodyPart = new Uint8Array(view.buffer, view.byteOffset + i, frameSize)
            message.body.set(bodyPart, message.bodyPos)
            message.bodyPos += frameSize
            i += frameSize
            if (message.bodyPos === message.bodySize)
              channel.onMessageReady(message)
          } else {
            console.warn("Body frame but no message")
          }
          break
        }
        case 8: { // heartbeat
          const heartbeat = new Uint8Array([8, 0, 0, 0, 0, 0, 0, 206])
          this.send(heartbeat).catch(err => console.warn("Error while sending heartbeat", err))
          break
        }
        default:
          console.error("invalid frame type:", type)
          i += frameSize
      }
      i += 1 // frame end
    }
  }
}
