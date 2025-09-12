import { AMQPBaseClient, VERSION } from "./amqp-base-client.js"
import { AMQPView } from "./amqp-view.js"
import { AMQPError } from "./amqp-error.js"
import { AMQPChannel } from "./amqp-channel.js"
import { AMQPConsumer } from "./amqp-consumer.js"
import { AMQPMessage } from "./amqp-message.js"
import { AMQPQueue } from "./amqp-queue.js"
import type { Logger } from "./types.js"

interface AMQPWebSocketInit {
  url: string
  vhost?: string
  username?: string
  password?: string
  name?: string
  frameMax?: number
  heartbeat?: number
  logger?: Logger | null
}

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
   * @param logger - optional logger instance, defaults to null (no logging)
   */
  constructor(
    url: string,
    vhost?: string,
    username?: string,
    password?: string,
    name?: string,
    frameMax?: number,
    heartbeat?: number,
    logger?: Logger | null,
  )
  constructor(init: AMQPWebSocketInit)
  constructor(
    url: string | AMQPWebSocketInit,
    vhost = "/",
    username = "guest",
    password = "guest",
    name?: string,
    frameMax = 8192,
    heartbeat = 0,
    logger?: Logger | null,
  ) {
    if (typeof url === "object") {
      vhost = url.vhost ?? vhost
      username = url.username ?? username
      password = url.password ?? password
      name = url.name ?? name
      frameMax = url.frameMax ?? frameMax
      heartbeat = url.heartbeat ?? heartbeat
      logger = url.logger ?? logger
      url = url.url
    }
    super(vhost, username, password, name, AMQPWebSocketClient.platform(), frameMax, heartbeat, 0, logger)
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
      socket.addEventListener("close", reject)
      socket.addEventListener("error", reject)
      socket.addEventListener("open", () => {
        socket.addEventListener("error", (ev: Event) => {
          if (!this.closed) {
            const err = new AMQPError(ev.toString(), this)
            this.closed = true
            // Close all channels and their consumers when there's an error
            this.channels.forEach((ch) => ch?.setClosed(err))
            this.channels = [new AMQPChannel(this, 0)]
            this.onerror(err)
          }
        })
        socket.addEventListener("close", (ev: CloseEvent) => {
          const clientClosed = this.closed
          this.closed = true
          if (!(ev.wasClean && clientClosed)) {
            const err = new AMQPError(`connection not cleanly closed (${ev.code})`, this)
            // Close all channels and their consumers when connection is lost
            this.channels.forEach((ch) => ch?.setClosed(err))
            this.channels = [new AMQPChannel(this, 0)]
            this.onerror(err)
          } else {
            this.channels.forEach((ch) => ch?.setClosed())
            this.channels = [new AMQPChannel(this, 0)]
          }
        })
        socket.send(new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]))
      })
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
        reject(new AMQPError("Socket not connected", this))
      }
    })
  }

  protected override closeSocket() {
    this.closed = true
    if (this.socket) this.socket.close()
    this.socket = undefined
  }

  private handleMessage(event: MessageEvent) {
    const buf: ArrayBuffer = event.data
    const bufView = new DataView(buf)
    // A socket read can contain 0 or more frames, so find frame boundries
    let bufPos = 0
    while (bufPos < buf.byteLength) {
      // read frame size of next frame
      if (this.frameSize === 0) {
        // first 7 bytes of a frame was split over two reads, this reads the second part
        if (this.framePos !== 0) {
          const len = 7 - this.framePos
          this.frameBuffer.set(new Uint8Array(buf, bufPos, len), this.framePos)
          this.frameSize = new DataView(this.frameBuffer.buffer).getInt32(bufPos + 3) + 8
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
    if (typeof navigator !== "undefined") return navigator.userAgent
    else return `${process.release.name} ${process.version} ${process.platform} ${process.arch}`
  }
}

export { AMQPBaseClient, AMQPChannel, AMQPConsumer, AMQPError, AMQPMessage, AMQPQueue, AMQPView, VERSION }
