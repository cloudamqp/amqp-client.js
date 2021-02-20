import AMQPBaseClient from './amqp-base-client.mjs'
import AMQPError from './amqp-error.mjs'
import AMQPView from './amqp-view.mjs'
import { Buffer } from 'buffer'
import net from 'net'
import tls from 'tls'

export default class AMQPClient extends AMQPBaseClient {
  constructor(url) {
    const u = new URL(url)
    const vhost = decodeURIComponent(u.pathname.slice(1)) || "/"
    const username = u.username || "guest"
    const password = u.password || "guest"
    const name = u.searchParams.get("name")
    super(vhost, username, password, name)
    this.tls = u.protocol === "amqps:"
    this.host = u.host || "localhost"
    this.port = u.port || this.tls ? 5671 : 5672
  }

  connect() {
    const socket = this.tls ? this.connectTLS() : this.connectPlain()
    Object.defineProperty(this, 'socket', {
      value: socket,
      enumerable: false // hide it from console.log etc.
    })
    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
      this.socket.on('error', (err) => reject(new AMQPError(err, this)))
    })
  }

  connectPlain() {
    let framePos = 0
    let frameSize = 0
    const frameBuffer = new Uint8Array(4096)
    const self = this
    const socket = net.connect({
      host: this.host,
      port: this.port,
      onread: {
        // Reuses a 4KiB Buffer for every read from the socket.
        buffer: Buffer.alloc(4096),
        callback: function(nread, buf) {
          // Find frame boundaries and only pass a single frame at a time
          let bufPos = 0
          while (bufPos < nread) {
            // read frame size of next frame
            if (frameSize === 0)
              frameSize = buf.readInt32BE(bufPos + 3) + 8

            const leftOfFrame = frameSize - framePos
            const copied = buf.copy(frameBuffer, framePos, bufPos, bufPos + leftOfFrame)
            framePos += copied
            bufPos += copied
            if (framePos === frameSize) {
              const view = new AMQPView(frameBuffer.buffer, 0, frameSize)
              self.parseFrames(view)
              frameSize = framePos = 0
            }
          }
        }
      }
    })
    socket.on('connect', () => {
      const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1])
      this.send(amqpstart)
    })
    return socket
  }

  connectTLS() {
    const socket = tls.connect({
      host: this.host,
      port: this.port,
      servername: this.host, // SNI
    })
    socket.on('secureConnect', () => {
      const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1])
      this.send(amqpstart)
    })
    let framePos = 0
    let frameSize = 0
    const frameBuffer = new Uint8Array(4096)
    socket.on('data', (buf) => {
      // Find frame boundaries and only pass a single frame at a time
      let bufPos = 0
      while (bufPos < buf.byteLength) {
        // read frame size of next frame
        if (frameSize === 0)
          frameSize = buf.readInt32BE(bufPos + 3) + 8

        const leftOfFrame = frameSize - framePos
        const copied = buf.copy(frameBuffer, framePos, bufPos, bufPos + leftOfFrame)
        framePos += copied
        bufPos += copied
        if (framePos === frameSize) {
          const view = new AMQPView(frameBuffer.buffer, 0, frameSize)
          this.parseFrames(view)
          frameSize = framePos = 0
        }
      }
    })
    return socket
  }

  send(bytes) {
    if (bytes instanceof ArrayBuffer)
      bytes = new Uint8Array(bytes)
    return this.socket.write(bytes, '', (err) => err && this.rejectPromise(err))
  }

  closeSocket() {
    this.socket.end()
  }
}
