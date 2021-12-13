import AMQPBaseClient from './amqp-base-client.mjs'
import AMQPError from './amqp-error.mjs'
import AMQPView from './amqp-view.mjs'
import { Buffer } from 'buffer'
import net from 'net'
import tls from 'tls'
import process from 'process'

/**
 * AMQP 0-9-1 client over TCP socket.
 */
export default class AMQPClient extends AMQPBaseClient {
  /**
   * @param {string} url - uri to the server, example: amqp://user:passwd@localhost:5672/vhost
   */
  constructor(url) {
    const u = new URL(url)
    const vhost = decodeURIComponent(u.pathname.slice(1)) || "/"
    const username = u.username || "guest"
    const password = u.password || "guest"
    const name = u.searchParams.get("name")
    const platform = `${process.release.name} ${process.version} ${process.platform} ${process.arch}`
    super(vhost, username, password, name, platform)
    this.tls = u.protocol === "amqps:"
    this.host = u.hostname || "localhost"
    this.port = parseInt(u.port) || (this.tls ? 5671 : 5672)
    /** @type {net.Socket?} */
    this.socket = null
  }

  /**
   * Try establish a connection
   * @return {Promise<AMQPBaseClient>}
   */
  connect() {
    const socket = this.tls ? this.connectTLS() : this.connectPlain()
    Object.defineProperty(this, 'socket', {
      value: socket,
      enumerable: false // hide it from console.log etc.
    })
    return new Promise((resolve, reject) => {
      socket.on('error', (err) => reject(new AMQPError(err.message, this)))
      this.connectPromise = /** @type {[function(AMQPBaseClient) : void, function(Error) : void]} */ ([resolve, reject])
    })
  }

  /** @private */
  connectPlain() {
    let framePos = 0
    let frameSize = 0
    const frameBuffer = new Uint8Array(16384)
    const self = this
    const socket = net.connect({
      host: this.host,
      port: this.port,
      onread: {
        buffer: Buffer.alloc(16384),
        callback: function(/** @type {number} */ bytesWritten, /** @type {Buffer} */ buf) {
          // Find frame boundaries and only pass a single frame at a time
          let bufPos = 0
          while (bufPos < bytesWritten) {
            // read frame size of next frame
            if (frameSize === 0)
              frameSize = buf.readInt32BE(bufPos + 3) + 8

            const leftOfFrame = frameSize - framePos
            const copyBytes = Math.min(leftOfFrame, bytesWritten - bufPos)
            const copied = buf.copy(frameBuffer, framePos, bufPos, bufPos + copyBytes)
            if (copied === 0) throw "Copied 0 bytes, please report this bug"
            framePos += copied
            bufPos += copied
            if (framePos === frameSize) {
              const view = new AMQPView(frameBuffer.buffer, 0, frameSize)
              self.parseFrames(view)
              frameSize = framePos = 0
            }
          }
          return true
        }
      }
    }, () => this.send(new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1])))
    return socket
  }

  /** @private */
  connectTLS() {
    let framePos = 0
    let frameSize = 0
    const frameBuffer = new Uint8Array(16384)
    const self = this
    const options = {
      servername: this.host, // SNI
      onread: {
        buffer: Buffer.alloc(16384),
        callback: (/** @type {number} */ bytesWritten, /** @type {Buffer} */ buf) => {
          // Find frame boundaries and only pass a single frame at a time
          let bufPos = 0
          while (bufPos < bytesWritten) {
            // read frame size of next frame
            if (frameSize === 0)
              frameSize = buf.readInt32BE(bufPos + 3) + 8

            const leftOfFrame = frameSize - framePos
            const copyBytes = Math.min(leftOfFrame, bytesWritten - bufPos)
            const copied = buf.copy(frameBuffer, framePos, bufPos, bufPos + copyBytes)
            if (copied === 0) throw "Copied 0 bytes, please report this bug"
            framePos += copied
            bufPos += copied
            if (framePos === frameSize) {
              const view = new AMQPView(frameBuffer.buffer, 0, frameSize)
              self.parseFrames(view)
              frameSize = framePos = 0
            }
          }
          return true
        }
      }
    }
    const socket = tls.connect(this.port, this.host, options, () => this.send(new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1])))
    return socket
  }

  /**
   * @ignore
   * @param {Uint8Array} bytes to send
   * @return {Promise<void>} fulfilled when the data is enqueued
   */
  send(bytes) {
    return new Promise((resolve, reject) => {
      if (this.socket)
        this.socket.write(bytes, undefined, (err) => err ? reject(err) : resolve())
      else
        reject("Socket not connected")
    })
  }

  /**
   * @protected
   */
  closeSocket() {
    if(this.socket) this.socket.end()
  }
}
