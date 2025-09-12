import { AMQPView } from "./amqp-view.js"
import type { Field } from "./amqp-properties.js"

// AMQP Frame Types (from AMQP 0-9-1 spec)
export enum Type {
  METHOD = 1,
  HEADER = 2,
  BODY = 3,
  HEARTBEAT = 8
}

// AMQP Frame End Byte (from AMQP 0-9-1 spec)
export enum End {
  CODE = 206
}

// AMQP Class IDs (partial, add more as needed)
export enum ClassId {
  CONNECTION = 10,
  CHANNEL = 20,
  EXCHANGE = 40,
  QUEUE = 50,
  BASIC = 60,
  TX = 90,
  CONFIRM = 85
}

// AMQP Method IDs by class (partial, add more as needed)
export enum ConnectionMethod {
  START = 10,
  START_OK = 11,
  SECURE = 20,
  SECURE_OK = 21,
  TUNE = 30,
  TUNE_OK = 31,
  OPEN = 40,
  OPEN_OK = 41,
  CLOSE = 50,
  CLOSE_OK = 51,
  BLOCKED = 60,
  UNBLOCKED = 61,
  UPDATE_SECRET = 70,
  UPDATE_SECRET_OK = 71
}

export enum ChannelMethod {
  OPEN = 10,
  OPEN_OK = 11,
  FLOW = 20,
  FLOW_OK = 21,
  CLOSE = 40,
  CLOSE_OK = 41
}

export enum ExchangeMethod {
  DECLARE = 10,
  DECLARE_OK = 11,
  DELETE = 20,
  DELETE_OK = 21,
  BIND = 30,
  BIND_OK = 31,
  UNBIND = 40,
  UNBIND_OK = 51
}

export enum QueueMethod {
  DECLARE = 10,
  DECLARE_OK = 11,
  BIND = 20,
  BIND_OK = 21,
  PURGE = 30,
  PURGE_OK = 31,
  DELETE = 40,
  DELETE_OK = 41,
  UNBIND = 50,
  UNBIND_OK = 51
}

export enum BasicMethod {
  QOS = 10,
  QOS_OK = 11,
  CONSUME = 20,
  CONSUME_OK = 21,
  CANCEL = 30,
  CANCEL_OK = 31,
  PUBLISH = 40,
  RETURN = 50,
  DELIVER = 60,
  GET = 70,
  GET_OK = 71,
  GET_EMPTY = 72,
  ACK = 80,
  REJECT = 90,
  RECOVER_ASYNC = 100,
  RECOVER = 110,
  RECOVER_OK = 111,
  NACK = 120
}

export enum TxMethod {
  SELECT = 10,
  SELECT_OK = 11,
  COMMIT = 20,
  COMMIT_OK = 21,
  ROLLBACK = 30,
  ROLLBACK_OK = 31
}

export enum ConfirmMethod {
  SELECT = 10,
  SELECT_OK = 11
}

interface FrameOptions {
  bufferSize: number
  type: Type
  channel: number
  frameSize?: number
  classId: ClassId
  method: number
}
export class Writer {
  view: AMQPView
  offset: number

  constructor(options: FrameOptions) {
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
    this.view.setUint8(this.offset, End.CODE)
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
