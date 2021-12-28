import { Buffer } from 'buffer'
import { AMQPProperties, Field } from './amqp-properties.js'

/**
 * An extended DataView, with AMQP protocol specific methods.
 * Set methods returns bytes written.
 * Get methods returns the value read and how many bytes it used.
 * @ignore
 */
declare global {
  interface Buffer {
    setUint8(byteOffset: number, value: number): void
    setUint16(byteOffset: number, value: number): void
    setUint32(byteOffset: number, value: number): void
    setUint64(byteOffset: number, value: number): void
    setShortString(byteOffset: number, value: string): number
    setLongString(byteOffset: number, value: string): number
    setTable(byteOffset: number, table : Record<string, Field>) : number
    setProperties(byteOffset: number, properties: AMQPProperties): number

    getUint8(byteOffset: number): number
    getUint16(byteOffset: number): number
    getUint32(byteOffset: number): number
    getUint64(byteOffset: number): number
    getShortString(byteOffset: number): [string, number]
    getLongString(byteOffset: number): [string, number]
    getProperties(byteOffset: number): [AMQPProperties, number]
  }
}

Buffer.prototype.getUint8 = function(byteOffset: number): number {
  return this.readUInt8(byteOffset)
}

Buffer.prototype.getUint16 = function(byteOffset: number): number {
  return this.readUInt16BE(byteOffset)
}

Buffer.prototype.getUint32 = function(byteOffset: number): number {
  return this.readUInt32BE(byteOffset)
}

Buffer.prototype.setUint8 = function(byteOffset: number, value: number): void {
  this.writeUInt8(value, byteOffset)
}

Buffer.prototype.setUint16 = function(byteOffset: number, value: number): void {
  this.writeUInt16BE(value, byteOffset)
}

Buffer.prototype.setUint32 = function(byteOffset: number, value: number): void {
  this.writeUInt32BE(value, byteOffset)
}

Buffer.prototype.setUint32 = function(byteOffset: number, value: number): void {
  this.writeUInt32BE(value, byteOffset)
}

Buffer.prototype.setShortString = function(byteOffset: number, value: string): number {
  return this.writeShortString(value, byteOffset)
}

Buffer.prototype.getUInt64 = function(byteOffset: number): number {
  return Number(this.readBigUInt64BE(byteOffset))
}

Buffer.prototype.writeUInt64 = function(value: number, byteOffset: number): number {
  return this.writeBigUInt64BE(BigInt(value), byteOffset)
}

Buffer.prototype.getUint64 = function(byteOffset: number) : number {
  // split 64-bit number into two 32-bit (4-byte) parts
  const left =  this.getUint32(byteOffset)
  const right = this.getUint32(byteOffset + 4)

  // combine the two 32-bit values
  const combined = 2**32 * left + right

  if (!Number.isSafeInteger(combined))
    console.warn(combined, 'exceeds MAX_SAFE_INTEGER. Precision may be lost')

  return combined
}

Buffer.prototype.setUint64 = function(byteOffset: number, value: number) : void {
  this.setBigUint64(byteOffset, BigInt(value))
}

Buffer.prototype.getInt64 = function(byteOffset: number) : number {
  return Number(this.getBigInt64(byteOffset))
}

Buffer.prototype.setInt64 = function(byteOffset: number, value: number) : void {
  this.setBigInt64(byteOffset, BigInt(value))
}

Buffer.prototype.getShortString = function(byteOffset: number): [string, number] {
  const len = this.getUint8(byteOffset)
  byteOffset += 1
  const text = this.toString('utf8', byteOffset, byteOffset + len)
  return [text, len + 1]
}

Buffer.prototype.setShortString = function(byteOffset: number, string: string) : number {
  const len = Buffer.byteLength(string)
  if (len > 255) throw new Error(`Short string too long, ${len} bytes: ${string.substring(0, 255)}...`)
  this.setUint8(byteOffset, len)
  byteOffset += 1
  this.write(string, byteOffset)
  return len + 1
}

Buffer.prototype.getLongString = function(byteOffset: number): [string, number] {
  const len = this.getUint32(byteOffset)
  byteOffset += 4
  const text = this.toString('utf8', byteOffset, byteOffset + len)
  return [text, len + 4]
}

Buffer.prototype.setLongString = function(byteOffset: number, string: string) : number {
  const len = Buffer.byteLength(string)
  this.setUint32(byteOffset, len)
  byteOffset += 4
  this.write(string, byteOffset)
  return len + 4
}

Buffer.prototype.getProperties = function(byteOffset: number): [AMQPProperties, number] {
  let j = byteOffset
  const flags = this.getUint16(j); j += 2
  const props: AMQPProperties = {}
  if ((flags & 0x8000) > 0) {
    const [contentType, len] = this.getShortString(j); j += len
    props.contentType = contentType
  }
  if ((flags & 0x4000) > 0) {
    const [contentEncoding, len] = this.getShortString(j); j += len
    props.contentEncoding = contentEncoding
  }
  if ((flags & 0x2000) > 0) {
    const [headers, len] = this.getTable(j); j += len
    props.headers = headers
  }
  if ((flags & 0x1000) > 0) {
    props.deliveryMode = this.getUint8(j); j += 1
  }
  if ((flags & 0x0800) > 0) {
    props.priority = this.getUint8(j); j += 1
  }
  if ((flags & 0x0400) > 0) {
    const [correlationId, len] = this.getShortString(j); j += len
    props.correlationId = correlationId
  }
  if ((flags & 0x0200) > 0) {
    const [replyTo, len] = this.getShortString(j); j += len
    props.replyTo = replyTo
  }
  if ((flags & 0x0100) > 0) {
    const [expiration, len] = this.getShortString(j); j += len
    props.expiration = expiration
  }
  if ((flags & 0x0080) > 0) {
    const [messageId, len] = this.getShortString(j); j += len
    props.messageId = messageId
  }
  if ((flags & 0x0040) > 0) {
    props.timestamp = new Date(this.getInt64(j) * 1000); j += 8
  }
  if ((flags & 0x0020) > 0) {
    const [type, len] = this.getShortString(j); j += len
    props.type = type
  }
  if ((flags & 0x0010) > 0) {
    const [userId, len] = this.getShortString(j); j += len
    props.userId = userId
  }
  if ((flags & 0x0008) > 0) {
    const [appId, len] = this.getShortString(j); j += len
    props.appId = appId
  }
  const len = j - byteOffset
  return [props, len]
}

Buffer.prototype.setProperties = function(byteOffset: number, properties: AMQPProperties): number {
  let j = byteOffset
  let flags = 0
  if (properties.contentType)     flags = flags | 0x8000
  if (properties.contentEncoding) flags = flags | 0x4000
  if (properties.headers)         flags = flags | 0x2000
  if (properties.deliveryMode)    flags = flags | 0x1000
  if (properties.priority)        flags = flags | 0x0800
  if (properties.correlationId)   flags = flags | 0x0400
  if (properties.replyTo)         flags = flags | 0x0200
  if (properties.expiration)      flags = flags | 0x0100
  if (properties.messageId)       flags = flags | 0x0080
  if (properties.timestamp)       flags = flags | 0x0040
  if (properties.type)            flags = flags | 0x0020
  if (properties.userId)          flags = flags | 0x0010
  if (properties.appId)           flags = flags | 0x0008
  this.setUint16(j, flags)
  j += 2
  if (properties.contentType) {
    j += this.setShortString(j, properties.contentType)
  }
  if (properties.contentEncoding) {
    j += this.setShortString(j, properties.contentEncoding)
  }
  if (properties.headers) {
    j += this.setTable(j, properties.headers)
  }
  if (properties.deliveryMode) {
    this.setUint8(j, properties.deliveryMode); j += 1
  }
  if (properties.priority) {
    this.setUint8(j, properties.priority); j += 1
  }
  if (properties.correlationId) {
    j += this.setShortString(j, properties.correlationId)
  }
  if (properties.replyTo) {
    j += this.setShortString(j, properties.replyTo)
  }
  if (properties.expiration) {
    j += this.setShortString(j, properties.expiration)
  }
  if (properties.messageId) {
    j += this.setShortString(j, properties.messageId)
  }
  if (properties.timestamp) { // Date
    const unixEpoch = Math.floor(Number(properties.timestamp) / 1000)
    this.setInt64(j, unixEpoch); j += 8
  }
  if (properties.type) {
    j += this.setShortString(j, properties.type)
  }
  if (properties.userId) {
    j += this.setShortString(j, properties.userId)
  }
  if (properties.appId) {
    j += this.setShortString(j, properties.appId)
  }
  const len = j - byteOffset
  return len
}

Buffer.prototype.getTable = function(byteOffset: number): [Record<string, Field>, number] {
  const table: Record<string, Field> = {}
  let i = byteOffset
  const len = this.getUint32(byteOffset); i += 4
  for (; i < byteOffset + 4 + len;) {
    const [k, strLen] = this.getShortString(i); i += strLen
    const [v, vLen] = this.getField(i); i += vLen
    table[k] = v
  }
  return [table, len + 4]
}

Buffer.prototype.setTable = function(byteOffset: number, table : Record<string, Field>) : number {
  // skip the first 4 bytes which are for the size
  let i = byteOffset + 4
  for (const [key, value] of Object.entries(table)) {
    if (value === undefined) continue
    i += this.setShortString(i, key)
    i += this.setField(i, value)
  }
  this.setUint32(byteOffset, i - byteOffset - 4) // update prefix length
  return i - byteOffset
}

Buffer.prototype.getField = function(byteOffset: number): [Field, number] {
  let i = byteOffset
  const k = this.getUint8(i); i += 1
  const type = String.fromCharCode(k)
  let v
  let len
  switch (type) {
    case 't': v = this.getUint8(i) === 1; i += 1; break
    case 'b': v = this.getInt8(i); i += 1; break
    case 'B': v = this.getUint8(i); i += 1; break
    case 's': v = this.getInt16(i); i += 2; break
    case 'u': v = this.getUint16(i); i += 2; break
    case 'I': v = this.getInt32(i); i += 4; break
    case 'i': v = this.getUint32(i); i += 4; break
    case 'l': v = this.getInt64(i); i += 8; break
    case 'f': v = this.getFloat32(i); i += 4; break
    case 'd': v = this.getFloat64(i); i += 8; break
    case 'S': [v, len] = this.getLongString(i); i += len; break
    case 'F': [v, len] = this.getTable(i); i += len; break
    case 'A': [v, len] = this.getArray(i); i += len; break
    case 'x': [v, len] = this.getByteArray(i); i += len; break
    case 'T': v = new Date(this.getInt64(i) * 1000); i += 8; break
    case 'V': v = null; break
    case 'D': {
      const scale = this.getUint8(i); i += 1
      const value = this.getUint32(i); i += 4
      v = value / 10**scale
      break
    }
    default:
      throw `Field type '${k}' not supported`
  }
  return [v, i - byteOffset]
}

Buffer.prototype.setField = function(byteOffset: number, field: Field) : number {
  let i = byteOffset
  switch (typeof field) {
    case "string":
      this.setUint8(i, 'S'.charCodeAt(0)); i += 1
      i += this.setLongString(i, field as string)
      break
    case "boolean":
      this.setUint8(i, 't'.charCodeAt(0)); i += 1
      this.setUint8(i, field ? 1 : 0); i += 1
      break
    case "bigint":
      this.setUint8(i, 'l'.charCodeAt(0)); i += 1
      this.setBigInt64(i, field as bigint); i += 8
      break
    case "number":
      if (Number.isInteger(field)) {
        if (-(2**32) < field && field < 2**32) {
          this.setUint8(i, 'I'.charCodeAt(0)); i += 1
          this.setInt32(i, field); i += 4
        } else {
          this.setUint8(i, 'l'.charCodeAt(0)); i += 1
          this.setInt64(i, field); i += 8
        }
      } else { // float
        if (-(2**32) < field && field < 2**32) {
          this.setUint8(i, 'f'.charCodeAt(0)); i += 1
          this.setFloat32(i, field); i += 4
        } else {
          this.setUint8(i, 'd'.charCodeAt(0)); i += 1
          this.setFloat64(i, field); i += 8
        }
      }
      break
    case "object":
      if (Array.isArray(field)) {
        this.setUint8(i, 'A'.charCodeAt(0)); i += 1
        i += this.setArray(i, field)
      } else if (field instanceof Uint8Array) {
        this.setUint8(i, 'x'.charCodeAt(0)); i += 1
        i += this.setByteArray(i, field)
      } else if (field instanceof ArrayBuffer) {
        this.setUint8(i, 'x'.charCodeAt(0)); i += 1
        i += this.setByteArray(i, new Uint8Array(field))
      } else if (field instanceof Date) {
        this.setUint8(i, 'T'.charCodeAt(0)); i += 1
        const unixEpoch = Math.floor(Number(field) / 1000)
        this.setInt64(i, unixEpoch); i += 8
      } else if (field === null || field === undefined) {
        this.setUint8(i, 'V'.charCodeAt(0)); i += 1
      } else { // hopefully it's a hash like object
        this.setUint8(i, 'F'.charCodeAt(0)); i += 1
        i += this.setTable(i, field as Record<string, Field>)
      }
      break
    default:
      throw `Unsupported field type '${field}'`
  }
  return i - byteOffset
}

Buffer.prototype.getArray = function(byteOffset: number): [Field[], number] {
  const len = this.getUint32(byteOffset); byteOffset += 4
  const endOffset = byteOffset + len
  const v = []
  for (; byteOffset < endOffset;) {
    const [field, fieldLen] = this.getField(byteOffset); byteOffset += fieldLen
    v.push(field)
  }
  return [v, len + 4]
}

Buffer.prototype.setArray = function(byteOffset: number, array: Field[]) : number {
  const start = byteOffset
  byteOffset += 4 // update the length later
  array.forEach((e) => {
    byteOffset += this.setField(byteOffset, e)
  })
  this.setUint32(start, byteOffset - start - 4) // update length
  return byteOffset - start
}

Buffer.prototype.getByteArray = function(byteOffset: number): [Uint8Array, number] {
  const len = this.getUint32(byteOffset); byteOffset += 4
  const v = new Uint8Array(this.buffer, this.byteOffset + byteOffset, len)
  return [v, len + 4]
}

Buffer.prototype.setByteArray = function(byteOffset: number, data: Uint8Array) : number {
  this.setUint32(byteOffset, data.byteLength); byteOffset += 4
  const view = new Uint8Array(this.buffer, this.byteOffset + byteOffset, data.byteLength)
  view.set(data)
  return data.byteLength + 4
}

Buffer.prototype.setFrameEnd = function(byteOffset: number) : 1 {
  this.setUint32(3, byteOffset - 7) // update frameSize
  this.setUint8(byteOffset, 206) // frame end byte
  return 1
}
