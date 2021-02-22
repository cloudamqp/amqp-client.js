import AMQPError from './amqp-error.mjs'

export default class AMQPConsumer {
  constructor(channel, tag, onMessage) {
    this.channel = channel
    this.tag = tag
    this.onMessage = onMessage
    this.closed = false
  }

  setClosed(err) {
    this.closed = err
    clearTimeout(this.timeoutId)
    if (err)
      if (this.rejectWait) this.rejectWait(err)
    else
      if (this.resolveWait) this.resolveWait()
  }

  cancel() {
    return this.channel.basicCancel(this.tag)
  }

  /** Wait for the consumer to finish
    * Returns a Promise that
    * resolves if the consumer/channel/connection is closed by the client
    * rejects if the server closed or there was a network error */
  wait(timeout) {
    if (this.closed === true) return Promise.resolve()
    if (this.closed) return Promise.reject(this.closed)
    return new Promise((resolve, reject) => {
      this.resolveWait = resolve
      this.rejectWait = reject
      if (timeout) {
        const onTimeout = () => reject(new AMQPError("Timeout", this.channel.connection))
        this.timeoutId = setTimeout(onTimeout, timeout)
      }
    })
  }
}
