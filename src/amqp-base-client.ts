import { AMQPChannel } from "./amqp-channel.js"
import { AMQPError } from "./amqp-error.js"
import * as AMQPFrame from "./amqp-frame.js"
import { AMQPMessage } from "./amqp-message.js"
import { AMQPView } from "./amqp-view.js"
import type { Logger } from "./types.js"

export const VERSION = "3.3.0"

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
  protected onUpdateSecretOk?: (value?: void) => void
  closed = true
  blocked?: string
  channelMax = 0
  frameMax: number
  heartbeat: number
  onerror: (error: AMQPError) => void
  logger: Logger | undefined
  /** Used for string -> arraybuffer when publishing */
  readonly textEncoder: InstanceType<typeof TextEncoder> = new TextEncoder()
  // Buffer pool for publishes, let multiple microtasks publish at the same time but save on allocations
  readonly bufferPool: AMQPView[] = []

  /**
   * @param name - name of the connection, set in client properties
   * @param platform - used in client properties
   * @param logger - optional logger instance, defaults to undefined (no logging)
   */
  constructor(
    vhost: string,
    username: string,
    password: string,
    name?: string,
    platform?: string,
    frameMax = 8192,
    heartbeat = 0,
    channelMax = 0,
    logger?: Logger | null,
  ) {
    this.vhost = vhost
    this.username = username
    this.password = ""
    Object.defineProperty(this, "password", {
      value: password,
      enumerable: false, // hide it from console.log etc.
    })
    if (name) this.name = name // connection name
    if (platform) this.platform = platform
    this.logger = logger || undefined
    this.channels = [new AMQPChannel(this, 0)]
    this.onerror = (error: AMQPError) => this.logger?.error("amqp-client connection closed", error.message)
    if (frameMax < 8192) throw new Error("frameMax must be 8192 or larger")
    this.frameMax = frameMax
    if (heartbeat < 0) throw new Error("heartbeat must be positive")
    this.heartbeat = heartbeat
    if (channelMax && channelMax < 0) throw new Error("channelMax must be positive")
    this.channelMax = channelMax
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
    if (!id) id = this.channels.findIndex((ch) => ch === undefined)
    if (id === -1) id = this.channels.length
    if (id > this.channelMax && this.channelMax > 0)
      return Promise.reject(new AMQPError("Max number of channels reached", this))

    const channel = new AMQPChannel(this, id)
    this.channels[id] = channel
    return channel.open()
  }

  /**
   * Gracefully close the AMQP connection
   * @param [reason] might be logged by the server
   */
  close(reason = "", code = 200): Promise<void> {
    if (this.closed) return this.rejectClosed()
    this.closed = true
    const frame = new AMQPFrame.Writer({
      bufferSize: 512,
      type: AMQPFrame.Type.METHOD,
      channel: 0,
      classId: AMQPFrame.ClassId.CONNECTION,
      method: AMQPFrame.ConnectionMethod.CLOSE,
    })
    frame.writeUint16(code) // reply code
    frame.writeShortString(reason) // reply reason
    frame.writeUint16(0) // failing-class-id
    frame.writeUint16(0) // failing-method-id
    frame.finalize()
    return new Promise((resolve, reject) => {
      this.send(frame.toUint8Array())
        .then(() => (this.closePromise = [resolve, reject]))
        .catch(reject)
    })
  }

  updateSecret(newSecret: string, reason: string) {
    const frame = new AMQPFrame.Writer({
      bufferSize: 8192,
      type: AMQPFrame.Type.METHOD,
      channel: 0,
      classId: AMQPFrame.ClassId.CONNECTION,
      method: AMQPFrame.ConnectionMethod.UPDATE_SECRET,
    })

    frame.writeLongString(newSecret)
    frame.writeShortString(reason)
    frame.finalize()
    return new Promise((resolve, reject) => {
      this.send(frame.toUint8Array())
        .then(() => (this.onUpdateSecretOk = resolve))
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
    for (let i = 0; i < view.byteLength; ) {
      const type = view.getUint8(i)
      i += 1
      const channelId = view.getUint16(i)
      i += 2
      const frameSize = view.getUint32(i)
      i += 4
      let frameEnd = 0
      try {
        frameEnd = view.getUint8(i + frameSize)
      } catch {
        throw new AMQPError(
          `Frame end out of range, frameSize=${frameSize}, pos=${i}, byteLength=${view.byteLength}`,
          this,
        )
      }
      if (frameEnd !== AMQPFrame.End.CODE)
        throw new AMQPError(`Invalid frame end ${frameEnd}, expected ${AMQPFrame.End.CODE}`, this)

      const channel = this.channels[channelId]
      if (!channel) {
        this.logger?.warn("AMQP channel", channelId, "not open")
        i += frameSize + 1
        continue
      }
      switch (type) {
        case AMQPFrame.Type.METHOD: {
          const classId = view.getUint16(i)
          i += 2
          const methodId = view.getUint16(i)
          i += 2
          switch (classId) {
            case AMQPFrame.ClassId.CONNECTION: {
              switch (methodId) {
                case AMQPFrame.ConnectionMethod.START: {
                  // ignore start frame, just reply startok
                  i += frameSize - 4

                  const startOk = new AMQPFrame.Writer({
                    bufferSize: 8192,
                    type: AMQPFrame.Type.METHOD,
                    channel: 0,
                    classId: AMQPFrame.ClassId.CONNECTION,
                    method: AMQPFrame.ConnectionMethod.START_OK,
                  })

                  const clientProps = {
                    connection_name: this.name || undefined,
                    product: "amqp-client.js",
                    information: "https://github.com/cloudamqp/amqp-client.js",
                    version: VERSION,
                    platform: this.platform,
                    capabilities: {
                      authentication_failure_close: true,
                      "basic.nack": true,
                      "connection.blocked": true,
                      consumer_cancel_notify: true,
                      exchange_exchange_bindings: true,
                      per_consumer_qos: true,
                      publisher_confirms: true,
                    },
                  }
                  startOk.writeTable(clientProps)
                  startOk.writeShortString("PLAIN") // authentication mechanism
                  const response = `\u0000${this.username}\u0000${this.password}`
                  startOk.writeLongString(response) // authentication response
                  startOk.writeShortString("") // locale
                  startOk.finalize()
                  this.send(startOk.toUint8Array()).catch(this.rejectConnect)
                  break
                }
                case AMQPFrame.ConnectionMethod.TUNE: {
                  const channelMax = view.getUint16(i)
                  i += 2
                  const frameMax = view.getUint32(i)
                  i += 4
                  const heartbeat = view.getUint16(i)
                  i += 2
                  this.channelMax = this.channelMax === 0 ? channelMax : Math.min(this.channelMax, channelMax)
                  this.frameMax = this.frameMax === 0 ? frameMax : Math.min(this.frameMax, frameMax)
                  this.heartbeat = this.heartbeat === 0 ? 0 : Math.min(this.heartbeat, heartbeat)

                  const tuneOk = new AMQPFrame.Writer({
                    bufferSize: 20,
                    type: AMQPFrame.Type.METHOD,
                    channel: 0,
                    frameSize: 12,
                    classId: AMQPFrame.ClassId.CONNECTION,
                    method: AMQPFrame.ConnectionMethod.TUNE_OK,
                  })
                  tuneOk.writeUint16(this.channelMax)
                  tuneOk.writeUint32(this.frameMax)
                  tuneOk.writeUint16(this.heartbeat)
                  tuneOk.finalize()
                  this.send(tuneOk.toUint8Array()).catch(this.rejectConnect)

                  const open = new AMQPFrame.Writer({
                    bufferSize: 512,
                    type: AMQPFrame.Type.METHOD,
                    channel: 0,
                    classId: AMQPFrame.ClassId.CONNECTION,
                    method: AMQPFrame.ConnectionMethod.OPEN,
                  })
                  open.writeShortString(this.vhost)
                  open.writeUint8(0) // reserved1
                  open.writeUint8(0) // reserved2
                  open.finalize()
                  this.send(open.toUint8Array()).catch(this.rejectConnect)

                  break
                }
                case AMQPFrame.ConnectionMethod.OPEN_OK: {
                  i += 1 // reserved1
                  this.closed = false
                  const promise = this.connectPromise
                  if (promise) {
                    const [resolve] = promise
                    delete this.connectPromise
                    resolve(this)
                  }
                  break
                }
                case AMQPFrame.ConnectionMethod.CLOSE: {
                  const code = view.getUint16(i)
                  i += 2
                  const [text, strLen] = view.getShortString(i)
                  i += strLen
                  const classId = view.getUint16(i)
                  i += 2
                  const methodId = view.getUint16(i)
                  i += 2
                  this.logger?.debug("connection closed by server", code, text, classId, methodId)

                  const msg = `connection closed: ${text} (${code})`
                  const err = new AMQPError(msg, this)
                  this.channels.forEach((ch) => ch.setClosed(err))
                  this.channels = [new AMQPChannel(this, 0)]

                  const closeOk = new AMQPFrame.Writer({
                    bufferSize: 12,
                    type: AMQPFrame.Type.METHOD,
                    channel: 0,
                    frameSize: 4,
                    classId: AMQPFrame.ClassId.CONNECTION,
                    method: AMQPFrame.ConnectionMethod.CLOSE_OK,
                  })
                  closeOk.finalize()
                  this.send(closeOk.toUint8Array()).catch((err) =>
                    this.logger?.warn("Error while sending Connection#CloseOk", err),
                  )
                  this.onerror(err)
                  this.rejectConnect(err)
                  this.onUpdateSecretOk?.()
                  break
                }
                case AMQPFrame.ConnectionMethod.CLOSE_OK: {
                  this.channels.forEach((ch) => ch.setClosed())
                  this.channels = [new AMQPChannel(this, 0)]
                  const promise = this.closePromise
                  if (promise) {
                    const [resolve] = promise
                    delete this.closePromise
                    resolve()
                    this.closeSocket()
                  }
                  break
                }
                case AMQPFrame.ConnectionMethod.BLOCKED: {
                  const [reason, len] = view.getShortString(i)
                  i += len
                  this.logger?.warn("AMQP connection blocked:", reason)
                  this.blocked = reason
                  break
                }
                case AMQPFrame.ConnectionMethod.UNBLOCKED: {
                  this.logger?.info("AMQP connection unblocked")
                  delete this.blocked
                  break
                }
                case AMQPFrame.ConnectionMethod.UPDATE_SECRET_OK: {
                  this.logger?.info("AMQP connection update secret ok")
                  this.onUpdateSecretOk?.()
                  delete this.onUpdateSecretOk
                  break
                }
                default:
                  i += frameSize - 4
                  this.logger?.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case AMQPFrame.ClassId.CHANNEL: {
              switch (methodId) {
                case AMQPFrame.ChannelMethod.OPEN_OK: {
                  i += 4 // reserved1 (long string)
                  channel.resolveRPC(channel)
                  break
                }
                case AMQPFrame.ChannelMethod.FLOW_OK: {
                  const active = view.getUint8(i) !== 0
                  i += 1
                  channel.resolveRPC(active)
                  break
                }
                case AMQPFrame.ChannelMethod.CLOSE: {
                  const code = view.getUint16(i)
                  i += 2
                  const [text, strLen] = view.getShortString(i)
                  i += strLen
                  const classId = view.getUint16(i)
                  i += 2
                  const methodId = view.getUint16(i)
                  i += 2
                  this.logger?.debug("channel", channelId, "closed", code, text, classId, methodId)

                  const msg = `channel ${channelId} closed: ${text} (${code})`
                  const err = new AMQPError(msg, this)
                  channel.setClosed(err)
                  delete this.channels[channelId]

                  const closeOk = new AMQPFrame.Writer({
                    bufferSize: 12,
                    type: AMQPFrame.Type.METHOD,
                    channel: channelId,
                    frameSize: 4,
                    classId: AMQPFrame.ClassId.CHANNEL,
                    method: AMQPFrame.ChannelMethod.CLOSE_OK,
                  })
                  closeOk.finalize()
                  this.send(closeOk.toUint8Array()).catch((err) =>
                    this.logger?.error("Error while sending Channel#closeOk", err),
                  )
                  break
                }
                case AMQPFrame.ChannelMethod.CLOSE_OK: {
                  channel.setClosed()
                  delete this.channels[channelId]
                  channel.resolveRPC()
                  break
                }
                default:
                  i += frameSize - 4 // skip rest of frame
                  this.logger?.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case AMQPFrame.ClassId.EXCHANGE: {
              switch (methodId) {
                case AMQPFrame.ExchangeMethod.DECLARE_OK:
                case AMQPFrame.ExchangeMethod.DELETE_OK:
                case AMQPFrame.ExchangeMethod.BIND_OK:
                case AMQPFrame.ExchangeMethod.UNBIND_OK: {
                  channel.resolveRPC()
                  break
                }
                default:
                  i += frameSize - 4 // skip rest of frame
                  this.logger?.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case AMQPFrame.ClassId.QUEUE: {
              switch (methodId) {
                case AMQPFrame.QueueMethod.DECLARE_OK: {
                  const [name, strLen] = view.getShortString(i)
                  i += strLen
                  const messageCount = view.getUint32(i)
                  i += 4
                  const consumerCount = view.getUint32(i)
                  i += 4
                  channel.resolveRPC({ name, messageCount, consumerCount })
                  break
                }
                case AMQPFrame.QueueMethod.BIND_OK: {
                  channel.resolveRPC()
                  break
                }
                case AMQPFrame.QueueMethod.PURGE_OK: {
                  const messageCount = view.getUint32(i)
                  i += 4
                  channel.resolveRPC({ messageCount })
                  break
                }
                case AMQPFrame.QueueMethod.DELETE_OK: {
                  const messageCount = view.getUint32(i)
                  i += 4
                  channel.resolveRPC({ messageCount })
                  break
                }
                case AMQPFrame.QueueMethod.UNBIND_OK: {
                  channel.resolveRPC()
                  break
                }
                default:
                  i += frameSize - 4
                  this.logger?.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case AMQPFrame.ClassId.BASIC: {
              switch (methodId) {
                case AMQPFrame.BasicMethod.QOS_OK: {
                  channel.resolveRPC()
                  break
                }
                case AMQPFrame.BasicMethod.CONSUME_OK: {
                  const [consumerTag, len] = view.getShortString(i)
                  i += len
                  channel.resolveRPC(consumerTag)
                  break
                }
                case AMQPFrame.BasicMethod.CANCEL: {
                  const [consumerTag, len] = view.getShortString(i)
                  i += len
                  const noWait = view.getUint8(i) === 1
                  i += 1

                  const consumer = channel.consumers.get(consumerTag)
                  if (consumer) {
                    consumer.setClosed(new AMQPError("Consumer cancelled by the server", this))
                    channel.consumers.delete(consumerTag)
                  }
                  if (!noWait) {
                    const frame = new AMQPFrame.Writer({
                      bufferSize: 512,
                      type: AMQPFrame.Type.METHOD,
                      channel: channel.id,
                      classId: AMQPFrame.ClassId.BASIC,
                      method: AMQPFrame.BasicMethod.CANCEL_OK,
                    })

                    frame.writeShortString(consumerTag)
                    frame.finalize()
                    this.send(frame.toUint8Array())
                  }
                  break
                }
                case AMQPFrame.BasicMethod.CANCEL_OK: {
                  const [consumerTag, len] = view.getShortString(i)
                  i += len
                  channel.resolveRPC(consumerTag)
                  break
                }
                case AMQPFrame.BasicMethod.RETURN: {
                  const code = view.getUint16(i)
                  i += 2
                  const [text, len] = view.getShortString(i)
                  i += len
                  const [exchange, exchangeLen] = view.getShortString(i)
                  i += exchangeLen
                  const [routingKey, routingKeyLen] = view.getShortString(i)
                  i += routingKeyLen
                  const message = new AMQPMessage(channel)
                  message.exchange = exchange
                  message.routingKey = routingKey
                  message.replyCode = code
                  message.replyText = text
                  channel.returned = message
                  break
                }
                case AMQPFrame.BasicMethod.DELIVER: {
                  const [consumerTag, consumerTagLen] = view.getShortString(i)
                  i += consumerTagLen
                  const deliveryTag = view.getUint64(i)
                  i += 8
                  const redelivered = view.getUint8(i) === 1
                  i += 1
                  const [exchange, exchangeLen] = view.getShortString(i)
                  i += exchangeLen
                  const [routingKey, routingKeyLen] = view.getShortString(i)
                  i += routingKeyLen
                  const message = new AMQPMessage(channel)
                  message.consumerTag = consumerTag
                  message.deliveryTag = deliveryTag
                  message.exchange = exchange
                  message.routingKey = routingKey
                  message.redelivered = redelivered
                  channel.delivery = message
                  break
                }
                case AMQPFrame.BasicMethod.GET_OK: {
                  const deliveryTag = view.getUint64(i)
                  i += 8
                  const redelivered = view.getUint8(i) === 1
                  i += 1
                  const [exchange, exchangeLen] = view.getShortString(i)
                  i += exchangeLen
                  const [routingKey, routingKeyLen] = view.getShortString(i)
                  i += routingKeyLen
                  const messageCount = view.getUint32(i)
                  i += 4
                  const message = new AMQPMessage(channel)
                  message.deliveryTag = deliveryTag
                  message.redelivered = redelivered
                  message.exchange = exchange
                  message.routingKey = routingKey
                  message.messageCount = messageCount
                  channel.getMessage = message
                  break
                }
                case AMQPFrame.BasicMethod.GET_EMPTY: {
                  const [, len] = view.getShortString(i)
                  i += len // reserved1
                  channel.resolveRPC(null)
                  break
                }
                case AMQPFrame.BasicMethod.ACK: {
                  const deliveryTag = view.getUint64(i)
                  i += 8
                  const multiple = view.getUint8(i) === 1
                  i += 1
                  channel.publishConfirmed(deliveryTag, multiple, false)
                  break
                }
                case AMQPFrame.BasicMethod.RECOVER_OK: {
                  channel.resolveRPC()
                  break
                }
                case AMQPFrame.BasicMethod.NACK: {
                  const deliveryTag = view.getUint64(i)
                  i += 8
                  const multiple = view.getUint8(i) === 1
                  i += 1
                  channel.publishConfirmed(deliveryTag, multiple, true)
                  break
                }
                default:
                  i += frameSize - 4
                  this.logger?.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case AMQPFrame.ClassId.CONFIRM: {
              switch (methodId) {
                case AMQPFrame.ConfirmMethod.SELECT_OK: {
                  channel.confirmId = 1
                  channel.resolveRPC()
                  break
                }
                default:
                  i += frameSize - 4
                  this.logger?.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            case AMQPFrame.ClassId.TX: {
              switch (methodId) {
                case AMQPFrame.TxMethod.SELECT_OK:
                case AMQPFrame.TxMethod.COMMIT_OK:
                case AMQPFrame.TxMethod.ROLLBACK_OK: {
                  channel.resolveRPC()
                  break
                }
                default:
                  i += frameSize - 4
                  this.logger?.error("unsupported class/method id", classId, methodId)
              }
              break
            }
            default:
              i += frameSize - 2
              this.logger?.error("unsupported class id", classId)
          }
          break
        }
        case AMQPFrame.Type.HEADER: {
          i += 4 // ignoring class id and weight
          const bodySize = view.getUint64(i)
          i += 8
          const [properties, propLen] = view.getProperties(i)
          i += propLen
          const message = channel.delivery || channel.getMessage || channel.returned
          if (message) {
            message.bodySize = bodySize
            message.properties = properties
            message.body = new Uint8Array(bodySize)
            if (bodySize === 0) channel.onMessageReady(message)
          } else {
            this.logger?.warn("Header frame but no message")
          }
          break
        }
        case AMQPFrame.Type.BODY: {
          const message = channel.delivery || channel.getMessage || channel.returned
          if (message && message.body) {
            const bodyPart = new Uint8Array(view.buffer, view.byteOffset + i, frameSize)
            message.body.set(bodyPart, message.bodyPos)
            message.bodyPos += frameSize
            i += frameSize
            if (message.bodyPos === message.bodySize) channel.onMessageReady(message)
          } else {
            this.logger?.warn("Body frame but no message")
          }
          break
        }
        case AMQPFrame.Type.HEARTBEAT: {
          const heartbeat = new Uint8Array([AMQPFrame.Type.HEARTBEAT, 0, 0, 0, 0, 0, 0, AMQPFrame.End.CODE])
          this.send(heartbeat).catch((err) => this.logger?.warn("Error while sending heartbeat", err))
          break
        }
        default:
          this.logger?.error("invalid frame type:", type)
          i += frameSize
      }
      i += 1 // frame end
    }
  }
}
