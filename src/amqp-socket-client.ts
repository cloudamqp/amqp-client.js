import { AMQPBaseClient } from './amqp-base-client'
import { AMQPError } from './amqp-error'
import { AMQPView } from './amqp-view'
import { Buffer } from 'buffer'
import net from 'net'
import tls from 'tls'
import process from 'process'

/**
 * AMQP 0-9-1 client over TCP socket.
 */
export class AMQPClient extends AMQPBaseClient {
  tls : boolean
  host : string
  port : number
  socket?: net.Socket
  /**
   * @param url - uri to the server, example: amqp://user:passwd@localhost:5672/vhost
   */
  constructor(url: string) {
    const u = new URL(url)
    const vhost = decodeURIComponent(u.pathname.slice(1)) || "/"
    const username = u.username || "guest"
    const password = u.password || "guest"
    const name = u.searchParams.get("name") || ""
    const platform = `${process.release.name} ${process.version} ${process.platform} ${process.arch}`
    super(vhost, username, password, name, platform)
    this.tls = u.protocol === "amqps:"
    this.host = u.hostname || "localhost"
    this.port = parseInt(u.port) || (this.tls ? 5671 : 5672)
  }

  override connect(): Promise<AMQPBaseClient> {
    const socket = this.connectSocket()
    Object.defineProperty(this, 'socket', {
      value: socket,
      enumerable: false // hide it from console.log etc.
    })
    return new Promise((resolve, reject) => {
      socket.on('error', (err) => reject(new AMQPError(err.message, this)))
      this.connectPromise = /** @type {} */ ([resolve, reject])
    })
  }

  /**
    * @private
    */
  connectSocket() {
    let framePos = 0
    let frameSize = 0
    const frameBuffer = Buffer.allocUnsafe(16384)
    const self = this
    const options = {
      host: this.host,
      port: this.port,
      servername: this.host
    }
    const sendStart = () => this.send(new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]))
    const conn = this.tls ? tls.connect(options, sendStart) : net.connect(options, sendStart)
    conn.on('data', (buf: Buffer) => {
      // A socket read can contain 0 or more frames, so find frame boundries
      let bufPos = 0
      while (bufPos < buf.length) {
        // read frame size of next frame
        if (frameSize === 0) {
          // first 7 bytes of a frame was split over two reads, this reads the second part
          if (framePos !== 0) {
            const copied = buf.copy(frameBuffer, framePos, bufPos, bufPos + 7 - framePos)
            if (copied === 0) throw `Copied 0 bytes framePos=${framePos} bufPos=${bufPos} bytesWritten=${buf.length}`
            frameSize = frameBuffer.readInt32BE(bufPos + 3) + 8
            framePos += copied
            bufPos += copied
            continue
          }
          // frame header is split over reads, copy to frameBuffer
          if (bufPos + 3 + 4 > buf.length) {
            const copied = buf.copy(frameBuffer, framePos, bufPos, buf.length)
            if (copied === 0) throw `Copied 0 bytes framePos=${framePos} bufPos=${bufPos} bytesWritten=${buf.length}`
            framePos += copied
            break
          }

          frameSize = buf.readInt32BE(bufPos + 3) + 8

          // avoid copying if the whole frame is in the read buffer
          if (buf.length - bufPos >= frameSize) {
            const view = new AMQPView(buf.buffer, buf.byteOffset + bufPos, frameSize)
            self.parseFrames(view)
            bufPos += frameSize
            frameSize = 0
            continue
          }
        }

        const leftOfFrame = frameSize - framePos
        const copyBytes = Math.min(leftOfFrame, buf.length - bufPos)
        const copied = buf.copy(frameBuffer, framePos, bufPos, bufPos + copyBytes)
        if (copied === 0) throw `Copied 0 bytes, please report this bug, frameSize=${frameSize} framePos=${framePos} bufPos=${bufPos} copyBytes=${copyBytes} bytesWritten=${buf.length}`
        framePos += copied
        bufPos += copied
        if (framePos === frameSize) {
          const view = new AMQPView(frameBuffer.buffer, 0, frameSize)
          self.parseFrames(view)
          frameSize = framePos = 0
        }
      }
    })
    return conn
  }

  /**
   * @ignore
   * @param bytes to send
   * @return fulfilled when the data is enqueued
   */
  override send(bytes: Uint8Array): Promise<void> {
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
  override closeSocket() {
    if(this.socket) this.socket.end()
  }
}
