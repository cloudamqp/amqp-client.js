import AMQPBaseClient from './amqpclient-base.mjs'
import AMQPView from './amqpview.mjs'

export default class AMQPWebSocketClient extends AMQPBaseClient {
  constructor(url, vhost, username, password) {
    super()
    this.url = url
    this.vhost = vhost
    this.username = username
    this.password = password
  }

  connect() {
    const socket = new WebSocket(this.url)
    socket.binaryType = "arraybuffer"
    this.socket = socket
    return new Promise((resolv, reject) => {
      this.resolvPromise = resolv
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

  close() {
    this.socket.close()
  }

}
