import { AMQPBaseClient } from './amqp-base-client.js'
import { AMQPError } from './amqp-error.js'
import { AMQPTlsOptions } from './amqp-tls-options'
import { AMQPView } from './amqp-view.js'
import { Buffer } from 'buffer'
import * as net from 'net'
import * as tls from 'tls'

/**
 * AMQP 0-9-1 client over TCP socket.
 */
export class AMQPClient extends AMQPBaseClient {
  socket?: net.Socket | undefined
  readonly tls : boolean
  readonly host : string
  readonly port : number
  readonly tlsOptions : AMQPTlsOptions | undefined
  private readonly insecure : boolean
  private framePos: number
  private frameSize: number
  private readonly frameBuffer: Buffer

  /**
   * @param url - uri to the server, example: amqp://user:passwd@localhost:5672/vhost
   */
  constructor(url: string, tlsOptions?: AMQPTlsOptions) {
    const u = new URL(url)
    const vhost = decodeURIComponent(u.pathname.slice(1)) || "/"
    const username = decodeURIComponent(u.username) || "guest"
    const password = decodeURIComponent(u.password) || "guest"
    const name = u.searchParams.get("name") || ""
    const frameMax = parseInt(u.searchParams.get("frameMax") || "4096")
    const heartbeat = parseInt(u.searchParams.get("heartbeat") || "0")
    const platform = `${process.release.name} ${process.version} ${process.platform} ${process.arch}`
    super(vhost, username, password, name, platform, frameMax, heartbeat)
    this.tls = u.protocol === "amqps:"
    this.tlsOptions = tlsOptions
    this.host = u.hostname || "localhost"
    this.port = parseInt(u.port) || (this.tls ? 5671 : 5672)
    this.insecure = u.searchParams.get("insecure") !== null
    this.framePos = 0
    this.frameSize = 0
    this.frameBuffer = Buffer.allocUnsafe(frameMax)
    Object.defineProperty(this, 'frameBuffer', {
      enumerable: false // hide it from console.log etc.
    })
  }

  override connect(): Promise<AMQPBaseClient> {
    const socket = this.connectSocket()
    Object.defineProperty(this, 'socket', {
      value: socket,
      writable: true,
      enumerable: false // hide it from console.log etc.
    })
    return new Promise((resolve, reject) => {
      socket.on('error', (err) => reject(new AMQPError(err.message, this)))
      this.connectPromise = [resolve, reject]
    })
  }

  private connectSocket(): net.Socket {
    const options = {
      host: this.host,
      port: this.port,
      servername: net.isIP(this.host) ? "" : this.host,
      rejectUnauthorized: !this.insecure,
      ...this.tlsOptions
    }
    const sendStart = () => this.send(new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]))
    const conn = this.tls ? tls.connect(options, sendStart) : net.connect(options, sendStart)
    conn.on('data', this.onRead.bind(this))
    conn.on('connect', () => {
      conn.on('error', (err) => this.onerror(new AMQPError(err.message, this)))
      conn.on('close', (hadError: boolean) => {
        if (!hadError && !this.closed) this.onerror(new AMQPError("Socket closed", this))
      })
    })
    return conn
  }

  private onRead(buf: Buffer): boolean {
    const bufLen = buf.length
    // A socket read can contain 0 or more frames, so find frame boundries
    let bufPos = 0
    while (bufPos < bufLen) {
      // read frame size of next frame
      if (this.frameSize === 0) {
        // first 7 bytes of a frame was split over two reads, this reads the second part
        if (this.framePos !== 0) {
          const copied = buf.copy(this.frameBuffer, this.framePos, bufPos, bufPos + 7 - this.framePos)
          if (copied === 0) throw `Copied 0 bytes framePos=${this.framePos} bufPos=${bufPos} bytesWritten=${bufLen}`
          this.frameSize = this.frameBuffer.readInt32BE(bufPos + 3) + 8
          this.framePos += copied
          bufPos += copied
          continue
        }
        // frame header is split over reads, copy to frameBuffer
        if (bufPos + 3 + 4 > bufLen) {
          const copied = buf.copy(this.frameBuffer, this.framePos, bufPos, bufLen)
          if (copied === 0) throw `Copied 0 bytes framePos=${this.framePos} bufPos=${bufPos} bytesWritten=${bufLen}`
          this.framePos += copied
          break
        }

        this.frameSize = buf.readInt32BE(bufPos + 3) + 8

        // avoid copying if the whole frame is in the read buffer
        if (bufLen - bufPos >= this.frameSize) {
          const view = new AMQPView(buf.buffer, buf.byteOffset + bufPos, this.frameSize)
          this.parseFrames(view)
          bufPos += this.frameSize
          this.frameSize = 0
          continue
        }
      }

      const leftOfFrame = this.frameSize - this.framePos
      const copyBytes = Math.min(leftOfFrame, bufLen - bufPos)
      const copied = buf.copy(this.frameBuffer, this.framePos, bufPos, bufPos + copyBytes)
      if (copied === 0) throw `Copied 0 bytes, please report this bug, frameSize=${this.frameSize} framePos=${this.framePos} bufPos=${bufPos} copyBytes=${copyBytes} bytesWritten=${bufLen}`
      this.framePos += copied
      bufPos += copied
      if (this.framePos === this.frameSize) {
        const view = new AMQPView(this.frameBuffer.buffer, 0, this.frameSize)
        this.parseFrames(view)
        this.frameSize = this.framePos = 0
      }
    }
    return true
  }

  /**
   * @ignore
   * @param bytes to send
   * @return fulfilled when the data is enqueued
   */
  override send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket)
        return reject(new AMQPError("Socket not connected", this))
      try {
        this.socket.write(bytes, undefined, (err) => err ? reject(err) : resolve())
      } catch (err) {
        this.closeSocket()
        reject(err)
      }
    })
  }

  protected override closeSocket(): void {
    this.closed = true
    if (this.socket) this.socket.end()
    this.socket = undefined
  }
}
