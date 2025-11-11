import { AMQPError } from "./amqp-error.js"
import * as AMQPFrame from "./amqp-frame.js"
import { AMQPView } from "./amqp-view.js"
import { AMQPQueue } from "./amqp-queue.js"
import { AMQPConsumer, AMQPGeneratorConsumer } from "./amqp-consumer.js"
import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPBaseClient } from "./amqp-base-client.js"
import type { AMQPProperties } from "./amqp-properties.js"

/**
 * Represents an AMQP Channel. Almost all actions in AMQP are performed on a Channel.
 */
export class AMQPChannel {
  readonly connection: AMQPBaseClient
  readonly id: number
  readonly consumers = new Map<string, AMQPConsumer | AMQPGeneratorConsumer>()
  private rpcQueue: Promise<unknown> = Promise.resolve(true)
  private readonly rpcCallbacks: [(value?: unknown) => void, (err?: Error) => void][] = []
  private readonly unconfirmedPublishes: [number, (confirmId: number) => void, (err?: Error) => void][] = []
  closed = false
  confirmId = 0
  delivery?: AMQPMessage
  getMessage?: AMQPMessage
  returned?: AMQPMessage
  onerror: (reason: string) => void
  /**
   * @param connection - The connection this channel belongs to
   * @param id - ID of the channel
   */
  constructor(connection: AMQPBaseClient, id: number) {
    this.connection = connection
    this.id = id
    this.onerror = (reason: string) => {
      this.logger?.error(`channel ${this.id} closed: ${reason}`)
      // Propagate channel errors to the connection's onerror handler
      this.connection.onerror(new AMQPError(`Channel ${this.id} closed: ${reason}`, this.connection))
    }
  }

  private get logger() {
    return this.connection.logger
  }

  open(): Promise<AMQPChannel> {
    const channelOpen = new AMQPFrame.Writer({
      bufferSize: 13,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      frameSize: 5,
      classId: AMQPFrame.ClassId.CHANNEL,
      method: AMQPFrame.ChannelMethod.OPEN,
    })

    channelOpen.writeUint8(0) // reserved1
    channelOpen.finalize()
    return this.sendRpc(channelOpen)
  }

  /**
   * Declare a queue and return an AMQPQueue instance.
   */
  queue(
    name = "",
    { passive = false, durable = name !== "", autoDelete = name === "", exclusive = name === "" }: QueueParams = {},
    args = {},
  ): Promise<AMQPQueue> {
    return new Promise((resolve, reject) => {
      this.queueDeclare(name, { passive, durable, autoDelete, exclusive }, args)
        .then(({ name }) => resolve(new AMQPQueue(this, name)))
        .catch(reject)
    })
  }

  /**
   * Alias for basicQos
   * @param prefetchCount - max inflight messages
   */
  prefetch(prefetchCount: number): Promise<void> {
    return this.basicQos(prefetchCount)
  }

  /**
   * Default handler for Returned messages
   * @param message returned from server
   */
  onReturn(message: AMQPMessage) {
    this.logger?.error("Message returned from server", message)
  }

  /**
   * Close the channel gracefully
   * @param [reason] might be logged by the server
   */
  close(reason = "", code = 200): Promise<void> {
    if (this.closed) return this.rejectClosed()
    this.closed = true
    const frame = new AMQPFrame.Writer({
      bufferSize: 512,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.CHANNEL,
      method: AMQPFrame.ChannelMethod.CLOSE,
    })
    frame.writeUint16(code) // reply code
    frame.writeShortString(reason) // reply reason
    frame.writeUint16(0) // failing-class-id
    frame.writeUint16(0) // failing-method-id
    frame.finalize()
    return this.sendRpc(frame)
  }

  /**
   * Synchronously receive a message from a queue
   * @param queue - name of the queue to poll
   * @param param
   * @param [param.noAck=true] - if message is removed from the server upon delivery, or have to be acknowledged
   * @return - returns null if the queue is empty otherwise a single message
   */
  basicGet(queue: string, { noAck = true } = {}): Promise<AMQPMessage | null> {
    if (this.closed) return this.rejectClosed()
    const frame = new AMQPFrame.Writer({
      bufferSize: 512,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.BASIC,
      method: AMQPFrame.BasicMethod.GET,
    })
    frame.writeUint16(0) // reserved1
    frame.writeShortString(queue)
    frame.writeUint8(noAck ? 1 : 0)
    frame.finalize()
    return this.sendRpc(frame)
  }

  /**
   * Consume from a queue. Messages will be delivered asynchronously.
   * @param queue - name of the queue to poll
   * @param param
   * @param [param.tag=""] - tag of the consumer, will be server generated if left empty
   * @param [param.noAck=true] - if messages are removed from the server upon delivery, or have to be acknowledged
   * @param [param.exclusive=false] - if this can be the only consumer of the queue, will return an Error if there are other consumers to the queue already
   * @param [param.args={}] - custom arguments
   * @param {function(AMQPMessage) : void | Promise<void>} callback - will be called for each message delivered to this consumer
   */
  basicConsume(
    queue: string,
    params: ConsumeParams,
    callback: (msg: AMQPMessage) => void | Promise<void>,
  ): Promise<AMQPConsumer>
  /**
   * Consume from a queue. Messages will be delivered asynchronously through an AsyncGenerator at `consumer.messages`.
   * @param queue - name of the queue to poll
   * @param param
   * @param [param.tag=""] - tag of the consumer, will be server generated if left empty
   * @param [param.noAck=true] - if messages are removed from the server upon delivery, or have to be acknowledged
   * @param [param.exclusive=false] - if this can be the only consumer of the queue, will return an Error if there are other consumers to the queue already
   * @param [param.args={}] - custom arguments
   * @return {AMQPGeneratorConsumer} - Consumer with an AsyncGenerator for messages at `consumer.messages`
   */
  basicConsume(queue: string, params: ConsumeParams): Promise<AMQPGeneratorConsumer>
  basicConsume(
    queue: string,
    { tag = "", noAck = true, exclusive = false, args = {} }: ConsumeParams = {},
    callback?: (msg: AMQPMessage) => void | Promise<void>,
  ): Promise<AMQPConsumer | AMQPGeneratorConsumer> {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    const noLocal = false
    const frame = new AMQPFrame.Writer({
      bufferSize: 4096,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.BASIC,
      method: AMQPFrame.BasicMethod.CONSUME,
    })
    frame.writeUint16(0) // reserved1
    frame.writeShortString(queue)
    frame.writeShortString(tag)
    let bits = 0
    if (noLocal) bits = bits | (1 << 0)
    if (noAck) bits = bits | (1 << 1)
    if (exclusive) bits = bits | (1 << 2)
    if (noWait) bits = bits | (1 << 3)
    frame.writeUint8(bits)
    frame.writeTable(args)
    frame.finalize()

    return new Promise((resolve, reject) => {
      this.sendRpc(frame)
        .then((consumerTag) => {
          let consumer: AMQPConsumer | AMQPGeneratorConsumer
          if (callback) {
            consumer = new AMQPConsumer(this, consumerTag, callback)
          } else {
            consumer = new AMQPGeneratorConsumer(this, consumerTag)
          }
          this.consumers.set(consumerTag, consumer)
          resolve(consumer)
        })
        .catch(reject)
    })
  }

  /**
   * Cancel/stop a consumer
   * @param tag - consumer tag
   */
  basicCancel(tag: string): Promise<AMQPChannel> {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    const frame = new AMQPFrame.Writer({
      bufferSize: 512,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.BASIC,
      method: AMQPFrame.BasicMethod.CANCEL,
    })
    frame.writeShortString(tag)
    frame.writeUint8(noWait ? 1 : 0)
    frame.finalize()

    return new Promise((resolve, reject) => {
      this.sendRpc(frame)
        .then((consumerTag) => {
          const consumer = this.consumers.get(consumerTag)
          if (consumer) {
            consumer.setClosed()
            this.consumers.delete(consumerTag)
          }
          resolve(this)
        })
        .catch(reject)
    })
  }

  /**
   * Acknowledge a delivered message
   * @param deliveryTag - tag of the message
   * @param [multiple=false] - batch confirm all messages up to this delivery tag
   */
  basicAck(deliveryTag: number, multiple = false): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const frame = new AMQPFrame.Writer({
      bufferSize: 21,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      frameSize: 13,
      classId: AMQPFrame.ClassId.BASIC,
      method: AMQPFrame.BasicMethod.ACK,
    })
    frame.writeUint64(deliveryTag)
    frame.writeUint8(multiple ? 1 : 0)
    frame.finalize()
    return this.connection.send(frame.toUint8Array())
  }

  /**
   * Acknowledge a delivered message
   * @param deliveryTag - tag of the message
   * @param [requeue=false] - if the message should be requeued or removed
   * @param [multiple=false] - batch confirm all messages up to this delivery tag
   */
  basicNack(deliveryTag: number, requeue = false, multiple = false): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const frame = new AMQPFrame.Writer({
      bufferSize: 21,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      frameSize: 13,
      classId: AMQPFrame.ClassId.BASIC,
      method: AMQPFrame.BasicMethod.NACK,
    })
    frame.writeUint64(deliveryTag)
    let bits = 0
    if (multiple) bits = bits | (1 << 0)
    if (requeue) bits = bits | (1 << 1)
    frame.writeUint8(bits)
    frame.finalize()
    return this.connection.send(frame.toUint8Array())
  }

  /**
   * Acknowledge a delivered message
   * @param deliveryTag - tag of the message
   * @param [requeue=false] - if the message should be requeued or removed
   */
  basicReject(deliveryTag: number, requeue = false): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const frame = new AMQPFrame.Writer({
      bufferSize: 21,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      frameSize: 13,
      classId: AMQPFrame.ClassId.BASIC,
      method: AMQPFrame.BasicMethod.REJECT,
    })
    frame.writeUint64(deliveryTag)
    frame.writeUint8(requeue ? 1 : 0)
    frame.finalize()
    return this.connection.send(frame.toUint8Array())
  }

  /**
   * Tell the server to redeliver all unacknowledged messages again, or reject and requeue them.
   * @param [requeue=false] - if the message should be requeued or redeliviered to this channel
   */
  basicRecover(requeue = false): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const frame = new AMQPFrame.Writer({
      bufferSize: 13,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      frameSize: 5,
      classId: AMQPFrame.ClassId.BASIC,
      method: AMQPFrame.BasicMethod.RECOVER,
    })
    frame.writeUint8(requeue ? 1 : 0)
    frame.finalize()
    return this.sendRpc(frame)
  }

  /**
   * Publish a message
   * @param exchange - the exchange to publish to, the exchange must exists
   * @param routingKey - routing key
   * @param data - the data to be published, can be a string or an uint8array
   * @param properties - properties to be published
   * @param [mandatory] - if the message should be returned if there's no queue to be delivered to
   * @param [immediate] - if the message should be returned if it can't be delivered to a consumer immediately (not supported in RabbitMQ)
   * @return - fulfilled when the message is enqueue on the socket, or if publish confirm is enabled when the message is confirmed by the server
   */
  async basicPublish(
    exchange: string,
    routingKey: string,
    data: string | Uint8Array | ArrayBuffer | Buffer | null,
    properties: AMQPProperties = {},
    mandatory = false,
    immediate = false,
  ): Promise<number> {
    if (this.closed) return this.rejectClosed()
    if (this.connection.blocked)
      return Promise.reject(new AMQPError(`Connection blocked by server: ${this.connection.blocked}`, this.connection))

    let body: Uint8Array
    if (typeof Buffer !== "undefined" && data instanceof Buffer) {
      body = data
    } else if (data instanceof Uint8Array) {
      body = data
    } else if (data instanceof ArrayBuffer) {
      body = new Uint8Array(data)
    } else if (data === null) {
      body = new Uint8Array(0)
    } else if (typeof data === "string") {
      body = this.connection.textEncoder.encode(data)
    } else {
      throw new TypeError(`Invalid type ${typeof data} for parameter data`)
    }

    let j = 0
    // get a buffer from the pool or create a new, it will later be returned to the pool for reuse
    let buffer = this.connection.bufferPool.pop() || new AMQPView(new ArrayBuffer(this.connection.frameMax))
    buffer.setUint8(j, AMQPFrame.Type.METHOD)
    j += 1
    buffer.setUint16(j, this.id)
    j += 2 // channel
    j += 4 // frame size, update later
    buffer.setUint16(j, AMQPFrame.ClassId.BASIC)
    j += 2
    buffer.setUint16(j, AMQPFrame.BasicMethod.PUBLISH)
    j += 2
    buffer.setUint16(j, 0)
    j += 2 // reserved1
    j += buffer.setShortString(j, exchange)
    j += buffer.setShortString(j, routingKey)
    let bits = 0
    if (mandatory) bits = bits | (1 << 0)
    if (immediate) bits = bits | (1 << 1)
    buffer.setUint8(j, bits)
    j += 1
    buffer.setUint8(j, AMQPFrame.End.CODE)
    j += 1
    buffer.setUint32(3, j - 8) // update frameSize

    const headerStart = j
    buffer.setUint8(j, AMQPFrame.Type.HEADER)
    j += 1
    buffer.setUint16(j, this.id)
    j += 2 // channel
    j += 4 // frame size, update later
    buffer.setUint16(j, AMQPFrame.ClassId.BASIC)
    j += 2
    buffer.setUint16(j, 0)
    j += 2 // weight
    buffer.setUint32(j, 0)
    j += 4 // bodysize (upper 32 of 64 bits)
    buffer.setUint32(j, body.byteLength)
    j += 4 // bodysize
    j += buffer.setProperties(j, properties)
    buffer.setUint8(j, AMQPFrame.End.CODE)
    j += 1
    buffer.setUint32(headerStart + 3, j - headerStart - 8) // update frameSize

    let bufferView = new Uint8Array(buffer.buffer)
    const bodyFrameCount = Math.ceil(body.byteLength / (this.connection.frameMax - 8))
    const bufferSize = j + body.byteLength + 8 * bodyFrameCount
    if (buffer.byteLength < bufferSize) {
      // the body doesn't fit in the buffer, expand it
      const newBuffer = new ArrayBuffer(bufferSize)
      const newBufferView = new Uint8Array(newBuffer)
      newBufferView.set(bufferView.subarray(0, j))
      buffer = new AMQPView(newBuffer)
      bufferView = newBufferView
    }

    // split body into multiple frames if body > frameMax
    for (let bodyPos = 0; bodyPos < body.byteLength; ) {
      const frameSize = Math.min(body.byteLength - bodyPos, this.connection.frameMax - 8) // frame overhead is 8 bytes
      const dataSlice = body.subarray(bodyPos, bodyPos + frameSize)

      buffer.setUint8(j, AMQPFrame.Type.BODY)
      j += 1
      buffer.setUint16(j, this.id)
      j += 2 // channel
      buffer.setUint32(j, frameSize)
      j += 4
      bufferView.set(dataSlice, j)
      j += frameSize // body content
      buffer.setUint8(j, AMQPFrame.End.CODE)
      j += 1
      bodyPos += frameSize
    }
    const sendFrames = this.connection.send(bufferView.subarray(0, j))

    // return buffer to buffer pool for later reuse
    // if publish confirm is enabled, put a promise on a queue if the sends were ok
    // the promise on the queue will be fullfilled by the read loop when an ack/nack
    // comes from the server
    if (this.confirmId) {
      const wait4Confirm = new Promise<number>((resolve, reject) =>
        this.unconfirmedPublishes.push([this.confirmId++, resolve, reject]),
      )
      return sendFrames.then(() => wait4Confirm).finally(() => this.connection.bufferPool.push(buffer))
    } else {
      return sendFrames.then(() => 0).finally(() => this.connection.bufferPool.push(buffer))
    }
  }

  /**
   * Set prefetch limit.
   * Recommended to set as each unacknowledged message will be stored in memory of the client.
   * The server won't deliver more messages than the limit until messages are acknowledged.
   * @param prefetchCount - number of messages to limit to
   * @param prefetchSize - number of bytes to limit to (not supported by RabbitMQ)
   * @param global - if the prefetch is limited to the channel, or if false to each consumer
   */
  basicQos(prefetchCount: number, prefetchSize = 0, global = false): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const frame = new AMQPFrame.Writer({
      bufferSize: 19,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      frameSize: 11,
      classId: AMQPFrame.ClassId.BASIC,
      method: AMQPFrame.BasicMethod.QOS,
    })
    frame.writeUint32(prefetchSize)
    frame.writeUint16(prefetchCount)
    frame.writeUint8(global ? 1 : 0)
    frame.finalize()
    return this.sendRpc(frame)
  }

  /**
   * Enable or disable flow. Disabling flow will stop the server from delivering messages to consumers.
   * Not supported in RabbitMQ
   * @param active - false to stop the flow, true to accept messages
   */
  basicFlow(active = true): Promise<boolean> {
    if (this.closed) return this.rejectClosed()
    const frame = new AMQPFrame.Writer({
      bufferSize: 13,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      frameSize: 5,
      classId: AMQPFrame.ClassId.CHANNEL,
      method: AMQPFrame.BasicMethod.CONSUME,
    })
    frame.writeUint8(active ? 1 : 0) // active flow
    frame.finalize()
    return this.sendRpc(frame)
  }

  /**
   * Enable publish confirm. The server will then confirm each publish with an Ack or Nack when the message is enqueued.
   */
  confirmSelect(): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const frame = new AMQPFrame.Writer({
      bufferSize: 13,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      frameSize: 5,
      classId: AMQPFrame.ClassId.CONFIRM,
      method: AMQPFrame.ConfirmMethod.SELECT,
    })
    frame.writeUint8(0) // noWait
    frame.finalize()
    return this.sendRpc(frame) // parseFrames in base will set channel.confirmId = 0
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
  queueDeclare(
    name = "",
    { passive = false, durable = name !== "", autoDelete = name === "", exclusive = name === "" }: QueueParams = {},
    args = {},
  ): Promise<QueueOk> {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    const declare = new AMQPFrame.Writer({
      bufferSize: 4096,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.QUEUE,
      method: AMQPFrame.QueueMethod.DECLARE,
    })
    declare.writeUint16(0) // reserved1
    declare.writeShortString(name)
    let bits = 0
    if (passive) bits = bits | (1 << 0)
    if (durable) bits = bits | (1 << 1)
    if (exclusive) bits = bits | (1 << 2)
    if (autoDelete) bits = bits | (1 << 3)
    if (noWait) bits = bits | (1 << 4)
    declare.writeUint8(bits)
    declare.writeTable(args)
    declare.finalize()
    return this.sendRpc(declare)
  }

  /**
   * Delete a queue
   * @param name - name of the queue, if empty it will delete the last declared queue
   * @param params
   * @param [params.ifUnused=false] - only delete if the queue doesn't have any consumers
   * @param [params.ifEmpty=false] - only delete if the queue is empty
   */
  queueDelete(name = "", { ifUnused = false, ifEmpty = false } = {}): Promise<MessageCount> {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    const frame = new AMQPFrame.Writer({
      bufferSize: 512,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.QUEUE,
      method: AMQPFrame.QueueMethod.DELETE,
    })
    frame.writeUint16(0) // reserved1
    frame.writeShortString(name)
    let bits = 0
    if (ifUnused) bits = bits | (1 << 0)
    if (ifEmpty) bits = bits | (1 << 1)
    if (noWait) bits = bits | (1 << 2)
    frame.writeUint8(bits)
    frame.finalize()
    return this.sendRpc(frame)
  }

  /**
   * Bind a queue to an exchange
   * @param queue - name of the queue
   * @param exchange - name of the exchange
   * @param routingKey - key to bind with
   * @param args - optional arguments, e.g. for header exchanges
   * @return fulfilled when confirmed by the server
   */
  queueBind(queue: string, exchange: string, routingKey: string, args = {}): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    const bind = new AMQPFrame.Writer({
      bufferSize: 4096,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.QUEUE,
      method: AMQPFrame.BasicMethod.CONSUME,
    })
    bind.writeUint16(0) // reserved1
    bind.writeShortString(queue)
    bind.writeShortString(exchange)
    bind.writeShortString(routingKey)
    bind.writeUint8(noWait ? 1 : 0)
    bind.writeTable(args)
    bind.finalize()
    return this.sendRpc(bind)
  }

  /**
   * Unbind a queue from an exchange
   * @param queue - name of the queue
   * @param exchange - name of the exchange
   * @param routingKey - key that was bound
   * @param args - arguments, e.g. for header exchanges
   * @return fulfilled when confirmed by the server
   */
  queueUnbind(queue: string, exchange: string, routingKey: string, args = {}): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const unbind = new AMQPFrame.Writer({
      bufferSize: 4096,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.QUEUE,
      method: AMQPFrame.QueueMethod.UNBIND,
    })
    unbind.writeUint16(0) // reserved1
    unbind.writeShortString(queue)
    unbind.writeShortString(exchange)
    unbind.writeShortString(routingKey)
    unbind.writeTable(args)
    unbind.finalize()
    return this.sendRpc(unbind)
  }

  /**
   * Purge a queue
   * @param queue - name of the queue
   * @return fulfilled when confirmed by the server
   */
  queuePurge(queue: string): Promise<MessageCount> {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    const purge = new AMQPFrame.Writer({
      bufferSize: 512,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.QUEUE,
      method: AMQPFrame.BasicMethod.CANCEL,
    })
    purge.writeUint16(0) // reserved1
    purge.writeShortString(queue)
    purge.writeUint8(noWait ? 1 : 0)
    purge.finalize()
    return this.sendRpc(purge)
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
  exchangeDeclare(
    name: string,
    type: ExchangeType,
    { passive = false, durable = true, autoDelete = false, internal = false }: ExchangeParams = {},
    args = {},
  ): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    const frame = new AMQPFrame.Writer({
      bufferSize: 4096,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.EXCHANGE,
      method: AMQPFrame.ExchangeMethod.DECLARE,
    })
    frame.writeUint16(0) // reserved1
    frame.writeShortString(name)
    frame.writeShortString(type)
    let bits = 0
    if (passive) bits = bits | (1 << 0)
    if (durable) bits = bits | (1 << 1)
    if (autoDelete) bits = bits | (1 << 2)
    if (internal) bits = bits | (1 << 3)
    if (noWait) bits = bits | (1 << 4)
    frame.writeUint8(bits)
    frame.writeTable(args)
    frame.finalize()
    return this.sendRpc(frame)
  }

  /**
   * Delete an exchange
   * @param name - name of the exchange
   * @param param
   * @param [param.ifUnused=false] - only delete if the exchange doesn't have any bindings
   * @return Fulfilled when the exchange is deleted or if it's already deleted
   */
  exchangeDelete(name: string, { ifUnused = false } = {}): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const noWait = false
    const frame = new AMQPFrame.Writer({
      bufferSize: 512,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.EXCHANGE,
      method: AMQPFrame.BasicMethod.CONSUME,
    })
    frame.writeUint16(0) // reserved1
    frame.writeShortString(name)
    let bits = 0
    if (ifUnused) bits = bits | (1 << 0)
    if (noWait) bits = bits | (1 << 1)
    frame.writeUint8(bits)
    frame.finalize()
    return this.sendRpc(frame)
  }

  /**
   * Exchange to exchange binding.
   * @param destination - name of the destination exchange
   * @param source - name of the source exchange
   * @param routingKey - key to bind with
   * @param args - optional arguments, e.g. for header exchanges
   * @return fulfilled when confirmed by the server
   */
  exchangeBind(destination: string, source: string, routingKey = "", args = {}): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const bind = new AMQPFrame.Writer({
      bufferSize: 4096,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.EXCHANGE,
      method: AMQPFrame.BasicMethod.CANCEL,
    })
    bind.writeUint16(0) // reserved1
    bind.writeShortString(destination)
    bind.writeShortString(source)
    bind.writeShortString(routingKey)
    bind.writeUint8(0)
    bind.writeTable(args)
    bind.finalize()
    return this.sendRpc(bind)
  }

  /**
   * Delete an exchange-to-exchange binding
   * @param destination - name of destination exchange
   * @param source - name of the source exchange
   * @param routingKey - key that was bound
   * @param args - arguments, e.g. for header exchanges
   * @return fulfilled when confirmed by the server
   */
  exchangeUnbind(destination: string, source: string, routingKey = "", args = {}): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const unbind = new AMQPFrame.Writer({
      bufferSize: 4096,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      classId: AMQPFrame.ClassId.EXCHANGE,
      method: AMQPFrame.ExchangeMethod.UNBIND,
    })
    unbind.writeUint16(0) // reserved1
    unbind.writeShortString(destination)
    unbind.writeShortString(source)
    unbind.writeShortString(routingKey)
    unbind.writeUint8(0)
    unbind.writeTable(args)
    unbind.finalize()
    return this.sendRpc(unbind)
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

  private txMethod(methodId: number): Promise<void> {
    if (this.closed) return this.rejectClosed()
    const frame = new AMQPFrame.Writer({
      bufferSize: 12,
      type: AMQPFrame.Type.METHOD,
      channel: this.id,
      frameSize: 4,
      classId: AMQPFrame.ClassId.TX,
      method: methodId,
    })
    frame.finalize()
    return this.sendRpc(frame)
  }

  /**
   * Send a RPC request, will resolve a RPC promise when RPC response arrives
   * @param frame - AMQP.AMQPFrame to send
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendRpc(frame: AMQPFrame.Writer): Promise<any> {
    const bytes = frame.toUint8Array()
    return new Promise((resolve, reject) => {
      this.rpcQueue = this.rpcQueue
        .then(() => {
          // Add the callbacks to the queue before sending
          this.rpcCallbacks.push([resolve, reject])

          return this.connection.send(bytes).catch((err) => {
            // Remove the callbacks from the queue if send fails
            const callbacks = this.rpcCallbacks.pop()
            if (callbacks) {
              callbacks[1](err) // call reject
            } else {
              reject(err)
            }
          })
        })
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
  setClosed(err?: Error): void {
    const closedByServer = err !== undefined
    err ||= new Error("Connection closed by client")
    if (!this.closed) {
      this.closed = true
      this.consumers.forEach((consumer) => consumer.setClosed(err))
      this.consumers.clear()

      // Reject all pending RPC callbacks
      this.rpcCallbacks.forEach(([, reject]) => reject(err))
      this.rpcCallbacks.length = 0

      // Reject and clear all unconfirmed publishes
      this.unconfirmedPublishes.forEach(([, , reject]) => reject(err))
      this.unconfirmedPublishes.length = 0
      if (closedByServer) this.onerror(err.message)
    }
  }

  /**
   * @return Rejected promise with an error
   */
  private rejectClosed() {
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
  publishConfirmed(deliveryTag: number, multiple: boolean, nack: boolean): void {
    // is queueMicrotask() needed here?
    const idx = this.unconfirmedPublishes.findIndex(([tag]) => tag === deliveryTag)
    if (idx !== -1) {
      const confirmed = multiple
        ? this.unconfirmedPublishes.splice(0, idx + 1)
        : this.unconfirmedPublishes.splice(idx, 1)
      confirmed.forEach(([tag, resolve, reject]) => {
        if (nack) reject(new Error("Message rejected"))
        else resolve(tag)
      })
    } else {
      this.logger?.warn("Cant find unconfirmed deliveryTag", deliveryTag, "multiple:", multiple, "nack:", nack)
    }
  }

  /**
   * Called from AMQPBaseClient when a message is ready
   * @ignore
   * @param message
   */
  onMessageReady(message: AMQPMessage): void {
    if (this.delivery) {
      delete this.delivery
      this.deliver(message)
    } else if (this.getMessage) {
      delete this.getMessage
      this.resolveRPC(message)
    } else {
      delete this.returned
      this.onReturn(message)
    }
  }

  /**
   * Resolvs next RPC command
   * @ignore
   */
  resolveRPC(value?: unknown): unknown | void {
    const callbacks = this.rpcCallbacks.shift()
    if (callbacks) {
      callbacks[0](value) // call resolve
    }
    return value
  }

  /**
   * Reject next RPC command
   * @ignore
   */
  rejectRPC(err?: Error): Error | void {
    const callbacks = this.rpcCallbacks.shift()
    if (callbacks) {
      callbacks[1](err) // call reject
    }
    return err
  }

  /**
   * Deliver a message to a consumer
   * @ignore
   */
  deliver(message: AMQPMessage): void {
    queueMicrotask(() => {
      const consumer = this.consumers.get(message.consumerTag)
      if (consumer) {
        consumer.onMessage(message)
      } else {
        this.logger?.warn("Consumer", message.consumerTag, "not available on channel", this.id)
      }
    })
  }
}

export type QueueOk = {
  name: string
  messageCount: number
  consumerCount: number
}

export type MessageCount = {
  messageCount: number
}

export type ExchangeType = "direct" | "fanout" | "topic" | "headers" | string

export type ExchangeParams = {
  /**
   * if the exchange name doesn't exist the channel will be closed with an error, fulfilled if the exchange name does exists
   */
  passive?: boolean
  /**
   * if the exchange should survive server restarts
   */
  durable?: boolean
  /**
   * if the exchange should be deleted when the last binding from it is deleted
   */
  autoDelete?: boolean
  /**
   * if exchange is internal to the server. Client's can't publish to internal exchanges.
   */
  internal?: boolean
}

export type QueueParams = {
  /**
   * if the queue name doesn't exist the channel will be closed with an error, fulfilled if the queue name does exists
   */
  passive?: boolean
  /**
   * if the queue should survive server restarts
   */
  durable?: boolean
  /**
   * if the queue should be deleted when the last consumer of the queue disconnects
   */
  autoDelete?: boolean
  /**
   * if the queue should be deleted when the channel is closed
   */
  exclusive?: boolean
}

/* * @param [param.tag=""] - tag of the consumer, will be server generated if left empty
 * @param [param.noAck=true] - if messages are removed from the server upon delivery, or have to be acknowledged
 * @param [param.exclusive=false] - if this can be the only consumer of the queue, will return an Error if there are other consumers to the queue already
 * @param [param.args={}] - custom arguments */

export type ConsumeParams = {
  /**
   * tag of the consumer, will be server generated if left empty
   */
  tag?: string
  /**
   * if messages are removed from the server upon delivery, or have to be acknowledged
   */
  noAck?: boolean
  /**
   * if this can be the only consumer of the queue, will return an Error if there are other consumers to the queue already
   */
  exclusive?: boolean
  /**
   * custom arguments
   */
  args?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}
