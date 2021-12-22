import AMQPBaseClient from './amqp-base-client.js'
import AMQPView from './amqp-view.js'

/** 
 * WebSocket client for AMQP 0-9-1 servers
 */
export default class AMQPWebSocketClient extends AMQPBaseClient {
  readonly url: string
  private socket?: WebSocket

/** 
 * @param url to the websocket endpoint, example: wss://server/ws/amqp
 */
  constructor(url: string, vhost = "/", username = "guest", password = "guest", name?: string) {
    super(vhost, username, password, name, AMQPWebSocketClient.platform())
    this.url = url
  }

  /**
   * Establish a AMQP connection over WebSocket
   */
  override connect(): Promise<AMQPBaseClient> {
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.binaryType = "arraybuffer"
    socket.onmessage = (event) => this.parseFrames(new AMQPView(event.data))
    return new Promise((resolve, reject) => {
      this.connectPromise = [resolve, reject]
      socket.onclose = reject
      socket.onerror = reject
      socket.onopen = () => socket.send(new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]))
    })
  }

  /**
   * @param bytes to send
   * @return fulfilled when the data is enqueued
   */
  override send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        try {
          this.socket.send(bytes)
          resolve()
        } catch (err) {
          reject(err)
        }
      } else {
        reject("Socket not connected")
      }
    })
  }

  protected override closeSocket() {
    if (this.socket) this.socket.close()
  }

  static platform(): string {
    if (typeof(window) !== 'undefined')
      return window.navigator.userAgent
    else
      return `${process.release.name} ${process.version} ${process.platform} ${process.arch}`
  }
}
