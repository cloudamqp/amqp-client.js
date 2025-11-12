import { AMQPError } from "./amqp-error.js"
import type { AMQPChannel } from "./amqp-channel.js"
import type { AMQPMessage } from "./amqp-message.js"

/**
 * A consumer, subscribed to a queue
 */
export class AMQPConsumer {
  readonly channel: AMQPChannel
  readonly tag: string
  readonly onMessage: (msg: AMQPMessage) => void | Promise<void>
  protected closed = false
  protected closedError?: Error
  private resolveWait?: (value: void) => void
  private rejectWait?: (err: Error) => void
  private timeoutId?: ReturnType<typeof setTimeout>

  /**
   * @param channel - the consumer is created on
   * @param tag - consumer tag
   * @param onMessage - callback executed when a message arrive
   */
  constructor(channel: AMQPChannel, tag: string, onMessage: (msg: AMQPMessage) => void | Promise<void>) {
    this.channel = channel
    this.tag = tag
    this.onMessage = onMessage
  }

  /**
   * Wait for the consumer to finish.
   * @param [timeout] wait for this many milliseconds and then return regardless
   * @return Fulfilled when the consumer/channel/connection is closed by the client. Rejected if the timeout is hit.
   */
  wait(timeout?: number): Promise<void> {
    if (this.closedError) return Promise.reject(this.closedError)
    if (this.closed) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.resolveWait = resolve
      this.rejectWait = reject
      if (timeout) {
        const onTimeout = () => reject(new AMQPError("Timeout", this.channel.connection))
        this.timeoutId = setTimeout(onTimeout, timeout)
      }
    })
  }

  /**
   * Cancel/abort/stop the consumer. No more messages will be deliviered to the consumer.
   * Note that any unacked messages are still unacked as they belong to the channel and not the consumer.
   */
  cancel() {
    return this.channel.basicCancel(this.tag)
  }

  /**
   * @ignore
   * @param [err] - why the consumer was closed
   */
  setClosed(err?: Error): void {
    this.closed = true
    if (err) this.closedError = err
    if (this.timeoutId) clearTimeout(this.timeoutId)
    if (err) {
      if (this.rejectWait) this.rejectWait(err)
    } else {
      if (this.resolveWait) this.resolveWait()
    }
  }
}

export class AMQPGeneratorConsumer extends AMQPConsumer {
  private messageQueue: AMQPMessage[] = []
  private messageResolver: ((msg: AMQPMessage) => void) | null = null
  private _generator?: AsyncGenerator<AMQPMessage, void, undefined>

  constructor(channel: AMQPChannel, tag: string) {
    super(channel, tag, (msg: AMQPMessage) => {
      // Feed messages to the generator queue
      if (this.messageResolver) {
        this.messageResolver(msg)
        this.messageResolver = null
      } else if (this.messageQueue) {
        this.messageQueue.push(msg)
      }
    })
  }

  /**
   * Get an AsyncGenerator for consuming messages.
   * @return An AsyncGenerator that yields messages
   */
  get messages(): AsyncGenerator<AMQPMessage, void, undefined> {
    if (this._generator) {
      return this._generator
    }

    this._generator = this.generateMessages()
    return this._generator
  }

  private async *generateMessages(): AsyncGenerator<AMQPMessage, void, undefined> {
    try {
      while (!this.closedError && !this.closed) {
        if (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift()!
          yield msg
        } else {
          const msg = await new Promise<AMQPMessage>((resolve) => {
            this.messageResolver = resolve
          })
          if (this.closedError || this.closed) break
          yield msg
        }
      }
      if (this.closedError) throw this.closedError
    } finally {
      // Clean up: cancel consumer when generator is done
      try {
        await this.cancel()
      } catch {
        // Ignore errors during cleanup
      }
    }
  }

  override setClosed(err?: Error): void {
    super.setClosed(err)
    // Wake up the generator if it's waiting
    if (this.messageResolver) {
      const resolver = this.messageResolver
      this.messageResolver = null
      // Resolve the promise with a sentinel value
      // The generator will check closedError/closed immediately and break without yielding
      resolver(undefined as unknown as AMQPMessage)
    }
  }
}
