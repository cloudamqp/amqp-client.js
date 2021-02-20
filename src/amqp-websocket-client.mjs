import AMQPBaseClient from './amqp-base-client.mjs'
import AMQPView from './amqp-view.mjs'

export default class AMQPWebSocketClient extends AMQPBaseClient {
  constructor(url, vhost, username, password, name) {
    super(vhost, username, password, name, window.navigator.userAgent)
    this.url = url
  }

  connect() {
    const socket = new WebSocket(this.url)
    socket.binaryType = "arraybuffer"
    this.socket = socket
    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
      socket.onclose = reject
      socket.onerror = reject
      socket.onopen = () => {
        const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1])
        socket.send(amqpstart)
      }
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const view = new AMQPView(event.data)
          this.parseFrames(view)
        } else {
          socket.close()
          reject("invalid data on socket")
        }
      }
    })
  }

  send(bytes) {
    return this.socket.send(bytes)
  }

  closeSocket() {
    this.socket.close()
  }
}
