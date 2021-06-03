import AMQPBaseClient from './amqp-base-client.js'
import AMQPView from './amqp-view.js'

/**
 * WebSocket client for AMQP 0-9-1 servers
 * @param url to the websocket endpoint
 * @param vhost, default '/'
 * @param username, default 'guest'
 * @param password, default 'guest'
 * @param name of the connection, no default
 */
export default class AMQPWebSocketClient extends AMQPBaseClient {
  url: string
  private socket: WebSocket
  constructor(url, vhost = "/", username = "guest", password = "guest", name = undefined) {
    super(vhost, username, password, name, window.navigator.userAgent)
    this.url = url
  }

  /**
   * Establish a AMQP connection over WebSocket
   * @return Promise to returns itself when successfully connected
   */
  connect(): Promise<AMQPWebSocketClient> {
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.binaryType = "arraybuffer"
    socket.onmessage = (event) => this.parseFrames(new AMQPView(event.data))
    return new Promise<AMQPWebSocketClient>((resolve, reject) => {
      this.connectPromise = [resolve, reject]
      socket.onclose = reject
      socket.onerror = reject
      socket.onopen = () => {
        const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1])
        socket.send(amqpstart)
      }
    })
  }

  /**
   * @ignore
   * @param bytes to send
   * @return fulfilled when the data is enqueued
   */
  send(bytes: Uint8Array): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        this.socket.send(bytes)
        resolve("")
      } catch (err) {
        reject(err)
      }
    })
  }

  /**
   * @ignore
   */
  closeSocket() {
    this.socket.close()
  }
}
