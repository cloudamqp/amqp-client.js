import AMQPBaseClient from './amqp-base-client.mjs'
import AMQPView from './amqp-view.mjs'

/** 
 * WebSocket client for AMQP 0-9-1 servers
 * @param {string} url to the websocket endpoint
 * @param {string} vhost, default '/'
 * @param {string} username, default 'guest'
 * @param {string} password, default 'guest'
 * @param {string} name of the connection, no default
 */
export default class AMQPWebSocketClient extends AMQPBaseClient {

/** 
 * @param {string} url to the websocket endpoint
 * @param {string} [vhost='/']
 * @param {string} [username='guest']
 * @param {string} [password='guest']
 * @param {string?} [name] of the connection, no default
 */
  constructor(url, vhost = "/", username = "guest", password = "guest", name = null) {
    super(vhost, username, password, name, window.navigator.userAgent)
    this.url = url
    this.socket = /** @type {WebSocket?} */ null
  }

  /**
   * Establish a AMQP connection over WebSocket
   * @return {Promise<AMQPBaseClient>} Promise to returns itself when successfully connected
   */
  connect() {
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.binaryType = "arraybuffer"
    socket.onmessage = (event) => this.parseFrames(new AMQPView(event.data))
    return new Promise((resolve, reject) => {
      this.connectPromise = /** @type {[function(AMQPBaseClient) : void, function(Error) : void]} */ ([resolve, reject])
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
   * @param {Uint8Array} bytes to send
   * @return {Promise<void>} fulfilled when the data is enqueued
   */
  send(bytes) {
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

  /**
   * @protected
   */
  closeSocket() {
    if (this.socket) this.socket.close()
  }
}
