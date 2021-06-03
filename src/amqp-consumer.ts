import AMQPChannel from './amqp-channel.js'
import AMQPError from './amqp-error.js'
import AMQPMessage from './amqp-message.js'

/**
 * A consumer, subscribed to a queue
 */
export class AMQPConsumer {
  channel: AMQPChannel
  tag: string
  onMessage: (message: AMQPMessage) => void
  private closed: boolean
  private closedError: string
  private resolveWait: (value: any) => void
  private rejectWait: (value: any) => void
  private timeoutId: NodeJS.Timeout
  /**
   * @param channel - the consumer is created on
   * @param tag - consumer tag
   * @param onMessage - callback executed when a message arrive
   */
  constructor(channel: AMQPChannel, tag: string, onMessage: (message: AMQPMessage) => void) {
    this.channel = channel
    this.tag = tag
    this.onMessage = onMessage
    this.closed = false
  }

  /**
   * Wait for the consumer to finish.
   * @param timeout wait for this many milliseconds and then return regardless
   * @return  - Fulfilled when the consumer/channel/connection is closed by the client. Rejected if the timeout is hit.
   */
  wait(timeout?: number): Promise<any> {
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
  cancel(): Promise<AMQPChannel> {
    return this.channel.basicCancel(this.tag)
  }

  setClosed(err: any): void {
    this.closed = true
    this.closedError = err
    clearTimeout(this.timeoutId)
    if (err) {
      if (this.rejectWait) this.rejectWait(err)
    } else {
      if (this.resolveWait) this.resolveWait("")
    }
  }
}

export default AMQPConsumer
