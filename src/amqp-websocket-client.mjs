import AMQPBaseClient from './amqp-base-client.mjs'
import AMQPView from './amqp-view.mjs'

export default class AMQPWebSocketClient extends AMQPBaseClient {
  constructor(url, vhost = "/", username = "guest", password = "guest", name = undefined) {
    super(vhost, username, password, name, window.navigator.userAgent)
    this.url = url
  }

  connect() {
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.binaryType = "arraybuffer"
    socket.onmessage = (event) => this.parseFrames(new AMQPView(event.data))
    return new Promise((resolve, reject) => {
      this.connectPromise = [resolve, reject]
      socket.onclose = reject
      socket.onerror = reject
      socket.onopen = () => {
        const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1])
        socket.send(amqpstart)
      }
    })
  }

  send(bytes) {
    return new Promise((resolve, reject) => {
      try {
        this.socket.send(bytes)
        resolve()
      } catch (err) {
        reject(err)
      }
    })
  }

  closeSocket() {
    this.socket.close()
  }
}
