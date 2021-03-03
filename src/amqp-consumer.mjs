import AMQPError from './amqp-error.mjs'

/**
 * A consumer, subscribed to a queue
 */
export default class AMQPConsumer {
  /**
   * @param {AMQPChannel} channel - the consumer is created on
   * @param {string} tag - consumer tag
   * @param {function(message: AMQPMessage)} onMessage - callback executed when a message arrive
   */
  constructor(channel, tag, onMessage) {
    this.channel = channel
    this.tag = tag
    this.onMessage = onMessage
  }

  /**
   * Wait for the consumer to finish.
   * @param {number} [timeout] wait for this many milliseconds and then return regardless
   * @return {Promise<, AMQPError>} - Fulfilled when the consumer/channel/connection is closed by the client. Rejected if the timeout is hit.
   */
  wait(timeout) {
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

  setClosed(err) {
    this.closed = true
    this.closedError = err
    clearTimeout(this.timeoutId)
    if (err) {
      if (this.rejectWait) this.rejectWait(err)
    } else {
      if (this.resolveWait) this.resolveWait()
    }
  }
}
