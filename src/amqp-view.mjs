/**
 * An extended DataView, with AMQP protocol specific methods
 * @ignore
 */
export default class AMQPView extends DataView {
  getUint64(byteOffset, littleEndian) {
    // split 64-bit number into two 32-bit (4-byte) parts
    const left =  this.getUint32(byteOffset, littleEndian)
    const right = this.getUint32(byteOffset + 4, littleEndian)

    // combine the two 32-bit values
    const combined = littleEndian ? left + 2**32 * right : 2**32 * left + right

    if (!Number.isSafeInteger(combined))
      console.warn(combined, 'exceeds MAX_SAFE_INTEGER. Precision may be lost')

    return combined
  }

  setUint64(byteOffset, value, littleEndian) {
    this.setBigUint64(byteOffset, BigInt(value), littleEndian)
  }

  getInt64(byteOffset, value, littleEndian) {
    return Number(this.getBigInt64(byteOffset, littleEndian))
  }

  setInt64(byteOffset, value, littleEndian) {
    this.setBigInt64(byteOffset, BigInt(value), littleEndian)
  }

  getShortString(byteOffset, littleEndian) {
    const len = this.getUint8(byteOffset, littleEndian)
    byteOffset += 1
    const view = new Uint8Array(this.buffer, byteOffset, len)
    const decoder = new TextDecoder()
    return [decoder.decode(view), len + 1]
  }

  setShortString(byteOffset, string, littleEndian) {
    const encoder = new TextEncoder()
    const utf8 = encoder.encode(string)
    this.setUint8(byteOffset, utf8.byteLength, littleEndian)
    byteOffset += 1
    const view = new Uint8Array(this.buffer, byteOffset)
    view.set(utf8)
    return utf8.byteLength + 1
  }

  getLongString(byteOffset, littleEndian) {
    const len = this.getUint32(byteOffset, littleEndian)
    byteOffset += 4
    const view = new Uint8Array(this.buffer, byteOffset, len)
    const decoder = new TextDecoder()
    return [decoder.decode(view), len + 4]
  }

  setLongString(byteOffset, string, littleEndian) {
    const encoder = new TextEncoder()
    const utf8 = encoder.encode(string)
    this.setUint32(byteOffset, utf8.byteLength, littleEndian)
    byteOffset += 4
    const view = new Uint8Array(this.buffer, byteOffset)
    view.set(utf8)
    return utf8.byteLength + 4
  }

  getProperties(byteOffset, littleEndian) {
    let j = byteOffset
    const flags = this.getUint16(j, littleEndian); j += 2
    const props = {}
    if ((flags & 0x8000) > 0) {
      const [contentType, len] = this.getShortString(j, littleEndian); j += len
      props.contentType = contentType
    }
    if ((flags & 0x4000) > 0) {
      const [contentEncoding, len] = this.getShortString(j, littleEndian); j += len
      props.contentEncoding = contentEncoding
    }
    if ((flags & 0x2000) > 0) {
      const [headers, len] = this.getTable(j, littleEndian); j += len
      props.headers = headers
    }
    if ((flags & 0x1000) > 0) {
      props.deliveryMode = this.getUint8(j, littleEndian); j += 1
    }
    if ((flags & 0x0800) > 0) {
      props.priority = this.getUint8(j, littleEndian); j += 1
    }
    if ((flags & 0x0400) > 0) {
      const [correlationId, len] = this.getShortString(j, littleEndian); j += len
      props.correlationId = correlationId
    }
    if ((flags & 0x0200) > 0) {
      const [replyTo, len] = this.getShortString(j, littleEndian); j += len
      props.replyTo = replyTo
    }
    if ((flags & 0x0100) > 0) {
      const [expiration, len] = this.getShortString(j, littleEndian); j += len
      props.expiration = expiration
    }
    if ((flags & 0x0080) > 0) {
      const [messageId, len] = this.getShortString(j, littleEndian); j += len
      props.messageId = messageId
    }
    if ((flags & 0x0040) > 0) {
      props.timestamp = new Date(this.getInt64(j, littleEndian) * 1000); j += 8
    }
    if ((flags & 0x0020) > 0) {
      const [type, len] = this.getShortString(j, littleEndian); j += len
      props.type = type
    }
    if ((flags & 0x0010) > 0) {
      const [userId, len] = this.getShortString(j, littleEndian); j += len
      props.userId = userId
    }
    if ((flags & 0x0008) > 0) {
      const [appId, len] = this.getShortString(j, littleEndian); j += len
      props.appId = appId
    }
    const len = j - byteOffset
    return [props, len]
  }

  setProperties(byteOffset, properties, littleEndian) {
    let j = byteOffset
    let flags = 0
    if (!(properties)) properties = {}
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
    this.setUint16(j, flags, littleEndian)
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
      this.setInt64(j, unixEpoch, littleEndian); j += 8
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

  getTable(byteOffset, littleEndian) {
    const table = {}
    let i = byteOffset
    const len = this.getUint32(byteOffset, littleEndian); i += 4
    for (; i < byteOffset + 4 + len;) {
      const [k, strLen] = this.getShortString(i, littleEndian); i += strLen
      const [v, vLen] = this.getField(i, littleEndian); i += vLen
      table[k] = v
    }
    return [table, len + 4]
  }

  setTable(byteOffset, table, littleEndian) {
    // skip the first 4 bytes which are for the size
    let i = byteOffset + 4
    for (let [key, value] of Object.entries(table)) {
      i += this.setShortString(i, key, littleEndian)
      i += this.setField(i, value, littleEndian)
    }
    this.setUint32(byteOffset, i - byteOffset - 4, littleEndian) // update prefix length
    return i - byteOffset
  }

  getField(byteOffset, littleEndian) {
    let i = byteOffset
    const k = this.getUint8(i, littleEndian); i += 1
    const type = String.fromCharCode(k)
    let v
    let len
    switch (type) {
      case 't': v = this.getUint8(i, littleEndian) === 1; i += 1; break
      case 'b': v = this.getInt8(i, littleEndian); i += 1; break
      case 'B': v = this.getUint8(i, littleEndian); i += 1; break
      case 's': v = this.getInt16(i, littleEndian); i += 2; break
      case 'u': v = this.getUint16(i, littleEndian); i += 2; break
      case 'I': v = this.getInt32(i, littleEndian); i += 4; break
      case 'i': v = this.getUint32(i, littleEndian); i += 4; break
      case 'l': v = this.getInt64(i, littleEndian); i += 8; break
      case 'f': v = this.getFloat32(i, littleEndian); i += 4; break
      case 'd': v = this.getFloat64(i, littleEndian); i += 8; break
      case 'S': [v, len] = this.getLongString(i, littleEndian); i += len; break
      case 'F': [v, len] = this.getTable(i, littleEndian); i += len; break
      case 'A': [v, len] = this.getArray(i, littleEndian); i += len; break
      case 'x': [v, len] = this.getByteArray(i); i += len; break
      case 'T': v = new Date(this.getInt64(i, littleEndian) * 1000); i += 8; break
      case 'V': v = null; break
      case 'D': {
        const scale = this.getUint8(i, littleEndian); i += 1
        const value = this.getUint32(i, littleEndian); i += 4
        v = value / 10**scale
        break
      }
      default:
        throw `Field type '${k}' not supported`
    }
    return [v, i - byteOffset]
  }

  setField(byteOffset, field, littleEndian) {
    let i = byteOffset
    switch (typeof field) {
      case "string":
        this.setUint8(i, 'S'.charCodeAt(), littleEndian); i += 1
        i += this.setLongString(i, field, littleEndian)
        break
      case "boolean":
        this.setUint8(i, 't'.charCodeAt(), littleEndian); i += 1
        this.setUint8(i, field ? 1 : 0, littleEndian); i += 1
        break
      case "bigint":
        this.setUint8(i, 'l'.charCodeAt(), littleEndian); i += 1
        this.setBigInt64(i, field, littleEndian); i += 8
        break
      case "number":
        if (Number.isInteger(field)) {
          if (-(2**32) < field < 2**32) {
            this.setUint8(i, 'I'.charCodeAt(), littleEndian); i += 1
            this.setInt32(i, field, littleEndian); i += 4
          } else {
            this.setUint8(i, 'l'.charCodeAt(), littleEndian); i += 1
            this.setInt64(i, field, littleEndian); i += 8
          }
        } else { // float
          if (-(2**32) < field < 2**32) {
            this.setUint8(i, 'f'.charCodeAt(), littleEndian); i += 1
            this.setFloat32(i, field, littleEndian); i += 4
          } else {
            this.setUint8(i, 'd'.charCodeAt(), littleEndian); i += 1
            this.setFloat64(i, field, littleEndian); i += 8
          }
        }
        break
      case undefined:
      case null:
        this.setUint8(i, 'V'.charCodeAt(), littleEndian); i += 1
        break
      case "object":
        if (Array.isArray(field)) {
          this.setUint8(i, 'A'.charCodeAt(), littleEndian); i += 1
          i += this.setArray(i, field, littleEndian)
        } else if (field instanceof ArrayBuffer || field instanceof Uint8Array) {
          this.setUint8(i, 'x'.charCodeAt(), littleEndian); i += 1
          i += this.setByteArray(i, field)
        } else if (field instanceof Date) {
          this.setUint8(i, 'T'.charCodeAt(), littleEndian); i += 1
          const unixEpoch = Math.floor(Number(field) / 1000)
          this.setInt64(i, unixEpoch, littleEndian); i += 8
        } else { // hopefully it's a hash like object
          this.setUint8(i, 'F'.charCodeAt(), littleEndian); i += 1
          i += this.setTable(i, field, littleEndian)
        }
        break
      default:
        throw `Unsupported field type '${field}'`
    }
    return i - byteOffset
  }

  getArray(byteOffset, littleEndian) {
    const len = this.getUint32(byteOffset, littleEndian); byteOffset += 4
    const endOffset = byteOffset + len
    const v = []
    for (; byteOffset < endOffset;) {
      const [field, fieldLen] = this.getField(byteOffset, littleEndian); byteOffset += fieldLen
      v.push(field)
    }
    return [v, len + 4]
  }

  setArray(byteOffset, array, littleEndian) {
    const start = byteOffset
    byteOffset += 4 // update the length later
    array.forEach((e) => {
      byteOffset += this.setField(byteOffset, e, littleEndian)
    })
    this.setUint32(start, byteOffset - start - 4, littleEndian) // update length
    return byteOffset - start
  }

  getByteArray(byteOffset) {
    const len = this.getUint32(byteOffset)
    const v = new Uint8Array(this.buffer, byteOffset + 4, len)
    return [v, len + 4]
  }

  setByteArray(byteOffset, data) {
    this.setUint32(byteOffset, data.byteLength)
    const view = new Uint8Array(this.buffer, byteOffset + 4, data.byteLength)
    view.set(data)
    return data.byteLength + 4
  }

  setFrameEnd(j) {
    this.setUint32(3, j - 7) // update frameSize
    this.setUint8(j, 206) // frame end byte
    return 1
  }
}
