import { AMQPBaseClient } from './amqp-base-client.js'
import { AMQPView } from './amqp-view.js'
import { AMQPError } from './amqp-error.js'

/** 
 * WebSocket client for AMQP 0-9-1 servers
 */
export class AMQPWebSocketClient extends AMQPBaseClient {
  readonly url: string
  private socket?: WebSocket | undefined
  private framePos = 0
  private frameSize = 0
  private frameBuffer: Uint8Array

  /**
   * @param url to the websocket endpoint, example: wss://server/ws/amqp
   */
  constructor(url: string, vhost = "/", username = "guest", password = "guest", name?: string, frameMax = 4096, heartbeat = 0) {
    super(vhost, username, password, name, AMQPWebSocketClient.platform(), frameMax, heartbeat)
    this.url = url
    this.frameBuffer = new Uint8Array(frameMax)
  }

  /**
   * Establish a AMQP connection over WebSocket
   */
  override connect(): Promise<AMQPBaseClient> {
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.binaryType = "arraybuffer"
    socket.onmessage = this.handleMessage.bind(this)
    return new Promise((resolve, reject) => {
      this.connectPromise = [resolve, reject]
      socket.onclose = reject
      socket.onerror = reject
      socket.onopen = () => {
        socket.onerror = (ev: Event) => this.onerror(new AMQPError(ev.toString(), this))
        socket.send(new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]))
      }
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
          this.closeSocket()
          reject(err)
        }
      } else {
        reject("Socket not connected")
      }
    })
  }

  protected override closeSocket() {
    this.closed = true
    if (this.socket) this.socket.close()
    this.socket = undefined
  }

  private handleMessage(event: MessageEvent) {
    const buf : ArrayBuffer = event.data
    const bufView = new DataView(buf)
    // A socket read can contain 0 or more frames, so find frame boundries
    let bufPos = 0
    while (bufPos < buf.byteLength) {
      // read frame size of next frame
      if (this.frameSize === 0) {
        // first 7 bytes of a frame was split over two reads, this reads the second part
        if (this.framePos !== 0) {
          const len = buf.byteLength - bufPos
          this.frameBuffer.set(new Uint8Array(buf, bufPos), this.framePos)
          this.frameSize = new DataView(this.frameBuffer).getInt32(bufPos + 3) + 8
          this.framePos += len
          bufPos += len
          continue
        }
        // frame header is split over multiple reads, copy to frameBuffer
        if (bufPos + 3 + 4 > buf.byteLength) {
          const len = buf.byteLength - bufPos
          this.frameBuffer.set(new Uint8Array(buf, bufPos), this.framePos)
          this.framePos += len
          break
        }

        this.frameSize = bufView.getInt32(bufPos + 3) + 8

        // avoid copying if the whole frame is in the read buffer
        if (buf.byteLength - bufPos >= this.frameSize) {
          const view = new AMQPView(buf, bufPos, this.frameSize)
          this.parseFrames(view)
          bufPos += this.frameSize
          this.frameSize = 0
          continue
        }
      }

      const leftOfFrame = this.frameSize - this.framePos
      const copyBytes = Math.min(leftOfFrame, buf.byteLength - bufPos)

      this.frameBuffer.set(new Uint8Array(buf, bufPos, copyBytes), this.framePos)
      this.framePos += copyBytes
      bufPos += copyBytes
      if (this.framePos === this.frameSize) {
        const view = new AMQPView(this.frameBuffer.buffer, 0, this.frameSize)
        this.parseFrames(view)
        this.frameSize = this.framePos = 0
      }
    }
  }

  static platform(): string {
    if (typeof(window) !== 'undefined')
      return window.navigator.userAgent
    else
      return `${process.release.name} ${process.version} ${process.platform} ${process.arch}`
  }
}
