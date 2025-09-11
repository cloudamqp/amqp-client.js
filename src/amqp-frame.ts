import { AMQPView } from "./amqp-view.js"
import type { Field } from "./amqp-properties.js"

interface AMQPFrameOptions {
  bufferSize: number
  type: number
  channel: number
  frameSize?: number
  classId: number
  method: number
}
export class AMQPFrame {
  view: AMQPView
  offset: number

  constructor(options: AMQPFrameOptions) {
    this.view = new AMQPView(new ArrayBuffer(options.bufferSize))
    this.offset = 0

    this.writeUint8(options.type)
    this.writeUint16(options.channel)
    this.writeUint32(options.frameSize ?? 0)
    this.writeUint16(options.classId)
    this.writeUint16(options.method)
  }

  finalize() {
    const currentFrameSize = this.view.getUint32(3)
    if (currentFrameSize === 0) {
      const value = this.offset - 7 // Subtract the size of the header (1 + 2 + 4)
      this.view.setUint32(3, value)
    }
    this.view.setUint8(this.offset, 206) // Write frame end byte
    this.offset += 1 // Update offset to point after the frame end byte
  }

  getBuffer() {
    return this.view.buffer
  }

  toUint8Array() {
    return new Uint8Array(this.view.buffer, 0, this.offset)
  }

  writeUint8(value: number) {
    this.view.setUint8(this.offset, value)
    this.offset += 1
  }

  writeUint16(value: number) {
    this.view.setUint16(this.offset, value)
    this.offset += 2
  }

  writeUint32(value: number) {
    this.view.setUint32(this.offset, value)
    this.offset += 4
  }

  writeUint64(value: number) {
    this.view.setUint64(this.offset, value)
    this.offset += 8
  }

  writeShortString(value: string) {
    // Assumes setShortString returns the number of bytes written
    const bytesWritten = this.view.setShortString(this.offset, value)
    this.offset += bytesWritten
  }

  writeLongString(value: string) {
    // Assumes setLongString returns the number of bytes written
    const bytesWritten = this.view.setLongString(this.offset, value)
    this.offset += bytesWritten
  }

  writeTable(table: Record<string, Field>) {
    // Assumes setTable returns the number of bytes written
    const bytesWritten = this.view.setTable(this.offset, table)
    this.offset += bytesWritten
  }
}
