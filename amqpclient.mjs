import AMQPBaseClient from './amqpclient-base.mjs'
import AMQPView from './amqpview.mjs'
import { Buffer } from 'buffer'
import net from 'net'

export default class AMQPClient extends AMQPBaseClient {
  constructor(url) {
    super()
    const u = new URL(url)
    this.tls = u.protocol == "amqps:"
    this.host = u.host || "localhost"
    this.port = u.port || this.tls ? 5671 : 5672
    this.vhost = decodeURIComponent(u.pathname.slice(1)) || "/"
    this.username = u.username || "guest"
    this.password = u.password || "guest"
  }

  connect() {
    let framePos = 0
    let frameSize = 0
    const frameBuffer = new Uint8Array(4096)
    const self = this
    const socket = net.connect({
      port: 5672,
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
    });
    this.socket = socket
    return new Promise((resolv, reject) => {
      this.resolvPromise = resolv
      this.rejectPromise = reject
      socket.on('error', reject)
      socket.on('connect', () => {
        const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1])
        self.send(amqpstart)
      })
    })
  }

  send(bytes) {
    if (bytes instanceof ArrayBuffer)
      bytes = new Uint8Array(bytes)
    return this.socket.write(bytes)
  }

  close() {
    this.socket.end()
  }
}
