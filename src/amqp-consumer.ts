import { AMQPError } from './amqp-error.js'
import { AMQPChannel } from './amqp-channel.js'
import { AMQPMessage } from './amqp-message.js'

/**
 * A consumer, subscribed to a queue
 */
export class AMQPConsumer {
  readonly channel: AMQPChannel
  readonly tag: string
  readonly onMessage: (msg: AMQPMessage) => void
  private closed = false
  private closedError?: Error
  private resolveWait?: (value: void) => void
  private rejectWait?: (err: Error) => void
  private timeoutId?: ReturnType<typeof setTimeout>

  /**
   * @param channel - the consumer is created on
   * @param tag - consumer tag
   * @param onMessage - callback executed when a message arrive
   */
  constructor(channel: AMQPChannel, tag: string, onMessage: (msg: AMQPMessage) => void) {
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
