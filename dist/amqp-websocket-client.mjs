class AMQPConsumer {
  constructor(channel, tag) {
    this.channel = channel;
    this.tag = tag;
  }

  cancel() {
    return this.channel.basicCancel(this.tag)
  }
}

class AMQPQueue {
  constructor(channel, name) {
    this.channel = channel;
    this.name = name;
  }

  bind(exchange, routingkey, args = {}) {
    return new Promise((resolve, reject) => {
      this.channel.queueBind(this.name, exchange, routingkey, args)
        .then(() => resolve(this))
        .catch(reject);
    })
  }

  unbind(exchange, routingkey, args = {}) {
    return new Promise((resolve, reject) => {
      this.channel.queueUnind(this.name, exchange, routingkey, args)
        .then(() => resolve(this))
        .catch(reject);
    })
  }

  publish(body, properties) {
    return new Promise((resolve, reject) => {
      this.channel.basicPublish("", this.name, body, properties)
        .then(() => resolve(this))
        .catch(reject);
    })
  }

  subscribe({noAck = true, exclusive = false} = {}, callback) {
    return new Promise((resolve, reject) => {
      this.channel.basicConsume(this.name, {noAck, exclusive}, callback)
        .then((consumerTag) => resolve(new AMQPConsumer(this.channel, consumerTag)))
        .catch(reject);
    })
  }

  unsubscribe(consumerTag) {
    return new Promise((resolve, reject) => {
      this.channel.basicCancel(consumerTag)
        .then(() => resolve(this))
        .catch(reject);
    })
  }

  delete() {
    return new Promise((resolve, reject) => {
      this.channel.queueDelete(this.name)
        .then(() => resolve(this))
        .catch(reject);
    })
  }
}

class AMQPView extends DataView {
  getUint64(byteOffset, littleEndian) {
    // split 64-bit number into two 32-bit (4-byte) parts
    const left =  this.getUint32(byteOffset, littleEndian);
    const right = this.getUint32(byteOffset + 4, littleEndian);

    // combine the two 32-bit values
    const combined = littleEndian ? left + 2**32 * right : 2**32 * left + right;

    if (!Number.isSafeInteger(combined))
      console.warn(combined, 'exceeds MAX_SAFE_INTEGER. Precision may be lost');

    return combined
  }

  setUint64(byteOffset, value, littleEndian) {
    this.setBigUint64(byteOffset, BigInt(value), littleEndian);
  }

  getInt64(byteOffset, value, littleEndian) {
    return Number(this.getBigInt64(byteOffset, littleEndian))
  }

  setInt64(byteOffset, value, littleEndian) {
    this.setBigInt64(byteOffset, BigInt(value), littleEndian);
  }

  getShortString(byteOffset, littleEndian) {
    const len = this.getUint8(byteOffset, littleEndian);
    byteOffset += 1;
    const view = new Uint8Array(this.buffer, byteOffset, len);
    const decoder = new TextDecoder();
    return [decoder.decode(view), len + 1]
  }

  setShortString(byteOffset, string, littleEndian) {
    const encoder = new TextEncoder();
    const utf8 = encoder.encode(string);
    this.setUint8(byteOffset, utf8.byteLength, littleEndian);
    byteOffset += 1;
    const view = new Uint8Array(this.buffer, byteOffset);
    view.set(utf8);
    return utf8.byteLength + 1
  }

  getLongString(byteOffset, littleEndian) {
    const len = this.getUint32(byteOffset, littleEndian);
    byteOffset += 4;
    const view = new Uint8Array(this.buffer, byteOffset, len);
    const decoder = new TextDecoder();
    return [decoder.decode(view), len + 4]
  }

  setLongString(byteOffset, string, littleEndian) {
    const encoder = new TextEncoder();
    const utf8 = encoder.encode(string);
    this.setUint32(byteOffset, utf8.byteLength, littleEndian);
    byteOffset += 4;
    const view = new Uint8Array(this.buffer, byteOffset);
    view.set(utf8);
    return utf8.byteLength + 4
  }

  getProperties(byteOffset, littleEndian) {
    let j = byteOffset;
    const flags = this.getUint16(j, littleEndian); j += 2;
    const props = {};
    if ((flags & 0x8000) > 0) {
      const [contentType, len] = this.getShortString(j, littleEndian); j += len;
      props.contentType = contentType;
    }
    if ((flags & 0x4000) > 0) {
      const [contentEncoding, len] = this.getShortString(j, littleEndian); j += len;
      props.contentEncoding = contentEncoding;
    }
    if ((flags & 0x2000) > 0) {
      const [headers, len] = this.getTable(j, littleEndian); j += len;
      props.headers = headers;
    }
    if ((flags & 0x1000) > 0) {
      props.deliveryMode = this.getUint8(j, littleEndian); j += 1;
    }
    if ((flags & 0x0800) > 0) {
      props.priority = this.getUint8(j, littleEndian); j += 1;
    }
    if ((flags & 0x0400) > 0) {
      const [correlationId, len] = this.getShortString(j, littleEndian); j += len;
      props.correlationId = correlationId;
    }
    if ((flags & 0x0200) > 0) {
      const [replyTo, len] = this.getShortString(j, littleEndian); j += len;
      props.replyTo = replyTo;
    }
    if ((flags & 0x0100) > 0) {
      const [expiration, len] = this.getShortString(j, littleEndian); j += len;
      props.expiration = expiration;
    }
    if ((flags & 0x0080) > 0) {
      const [messageId, len] = this.getShortString(j, littleEndian); j += len;
      props.messageId = messageId;
    }
    if ((flags & 0x0040) > 0) {
      props.timestamp = new Date(this.getInt64(j, littleEndian) * 1000); j += 8;
    }
    if ((flags & 0x0020) > 0) {
      const [type, len] = this.getShortString(j, littleEndian); j += len;
      props.type = type;
    }
    if ((flags & 0x0010) > 0) {
      const [userId, len] = this.getShortString(j, littleEndian); j += len;
      props.userId = userId;
    }
    if ((flags & 0x0008) > 0) {
      const [appId, len] = this.getShortString(j, littleEndian); j += len;
      props.appId = appId;
    }
    const len = j - byteOffset;
    return [props, len]
  }

  setProperties(byteOffset, properties, littleEndian) {
    let j = byteOffset;
    let flags = 0;
    if (!(properties)) properties = {};
    if (properties.contentType)     flags = flags | 0x8000;
    if (properties.contentEncoding) flags = flags | 0x4000;
    if (properties.headers)         flags = flags | 0x2000;
    if (properties.deliveryMode)    flags = flags | 0x1000;
    if (properties.priority)        flags = flags | 0x0800;
    if (properties.correlationId)   flags = flags | 0x0400;
    if (properties.replyTo)         flags = flags | 0x0200;
    if (properties.expiration)      flags = flags | 0x0100;
    if (properties.messageId)       flags = flags | 0x0080;
    if (properties.timestamp)       flags = flags | 0x0040;
    if (properties.type)            flags = flags | 0x0020;
    if (properties.userId)          flags = flags | 0x0010;
    if (properties.appId)           flags = flags | 0x0008;
    this.setUint16(j, flags, littleEndian);
    j += 2;
    if (properties.contentType) {
      j += this.setShortString(j, properties.contentType);
    }
    if (properties.contentEncoding) {
      j += this.setShortString(j, properties.contentEncoding);
    }
    if (properties.headers) {
      j += this.setTable(j, properties.headers);
    }
    if (properties.deliveryMode) {
      this.setUint8(j, properties.deliveryMode); j += 1;
    }
    if (properties.priority) {
      this.setUint8(j, properties.priority); j += 1;
    }
    if (properties.correlationId) {
      j += this.setShortString(j, properties.correlationId);
    }
    if (properties.replyTo) {
      j += this.setShortString(j, properties.replyTo);
    }
    if (properties.expiration) {
      j += this.setShortString(j, properties.expiration);
    }
    if (properties.messageId) {
      j += this.setShortString(j, properties.messageId);
    }
    if (properties.timestamp) { // Date
      const unixEpoch = Math.floor(Number(properties.timestamp) / 1000);
      this.setInt64(j, unixEpoch, littleEndian); j += 8;
    }
    if (properties.type) {
      j += this.setShortString(j, properties.type);
    }
    if (properties.userId) {
      j += this.setShortString(j, properties.userId);
    }
    if (properties.appId) {
      j += this.setShortString(j, properties.appId);
    }
    const len = j - byteOffset;
    return len
  }

  getTable(byteOffset, littleEndian) {
    const table = {};
    let i = byteOffset;
    const len = this.getUint32(byteOffset, littleEndian); i += 4;
    for (; i < byteOffset + 4 + len;) {
      const [k, strLen] = this.getShortString(i, littleEndian); i += strLen;
      const [v, vLen] = this.getField(i, littleEndian); i += vLen;
      table[k] = v;
    }
    return [table, len + 4]
  }

  setTable(byteOffset, table, littleEndian) {
    // skip the first 4 bytes which are for the size
    let i = byteOffset + 4;
    for (let [key, value] of Object.entries(table)) {
      i += this.setShortString(i, key, littleEndian);
      i += this.setField(i, value, littleEndian);
    }
    this.setUint32(byteOffset, i - byteOffset - 4, littleEndian); // update prefix length
    return i - byteOffset
  }

  getField(byteOffset, littleEndian) {
    let i = byteOffset;
    const k = this.getUint8(i, littleEndian); i += 1;
    const type = String.fromCharCode(k);
    let v;
    let len;
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
        const scale = this.getUint8(i, littleEndian); i += 1;
        const value = this.getUint32(i, littleEndian); i += 4;
        v = value / 10**scale;
        break
      }
      default:
        throw `Field type '${k}' not supported`
    }
    return [v, i - byteOffset]
  }

  setField(byteOffset, field, littleEndian) {
    let i = byteOffset;
    switch (typeof field) {
      case "string":
        this.setUint8(i, 'S'.charCodeAt(), littleEndian); i += 1;
        i += this.setLongString(i, field, littleEndian);
        break
      case "boolean":
        this.setUint8(i, 't'.charCodeAt(), littleEndian); i += 1;
        this.setUint8(i, field ? 1 : 0, littleEndian); i += 1;
        break
      case "bigint":
        this.setUint8(i, 'l'.charCodeAt(), littleEndian); i += 1;
        this.setBigInt64(i, field, littleEndian); i += 8;
        break
      case "number":
        if (Number.isInteger(field)) {
          if (-(2**32) < field < 2**32) {
            this.setUint8(i, 'I'.charCodeAt(), littleEndian); i += 1;
            this.setInt32(i, field, littleEndian); i += 4;
          } else {
            this.setUint8(i, 'l'.charCodeAt(), littleEndian); i += 1;
            this.setInt64(i, field, littleEndian); i += 8;
          }
        } else { // float
          if (-(2**32) < field < 2**32) {
            this.setUint8(i, 'f'.charCodeAt(), littleEndian); i += 1;
            this.setFloat32(i, field, littleEndian); i += 4;
          } else {
            this.setUint8(i, 'd'.charCodeAt(), littleEndian); i += 1;
            this.setFloat64(i, field, littleEndian); i += 8;
          }
        }
        break
      case undefined:
      case null:
        this.setUint8(i, 'V'.charCodeAt(), littleEndian); i += 1;
        break
      case "object":
        if (Array.isArray(field)) {
          this.setUint8(i, 'A'.charCodeAt(), littleEndian); i += 1;
          i += this.setArray(i, field, littleEndian);
        } else if (field instanceof ArrayBuffer || field instanceof Uint8Array) {
          this.setUint8(i, 'x'.charCodeAt(), littleEndian); i += 1;
          i += this.setByteArray(i, field);
        } else if (field instanceof Date) {
          this.setUint8(i, 'T'.charCodeAt(), littleEndian); i += 1;
          const unixEpoch = Math.floor(Number(field) / 1000);
          this.setInt64(i, unixEpoch, littleEndian); i += 8;
        } else { // hopefully it's a hash like object
          this.setUint8(i, 'F'.charCodeAt(), littleEndian); i += 1;
          i += this.setTable(i, field, littleEndian);
        }
        break
      default:
        throw `Unsupported field type '${field}'`
    }
    return i - byteOffset
  }

  getArray(byteOffset, littleEndian) {
    const len = this.getUint32(byteOffset, littleEndian); byteOffset += 4;
    const endOffset = byteOffset + len;
    const v = [];
    for (; byteOffset < endOffset;) {
      const [field, fieldLen] = this.getField(byteOffset, littleEndian); byteOffset += fieldLen;
      v.push(field);
    }
    return [v, len + 4]
  }

  setArray(byteOffset, array, littleEndian) {
    const start = byteOffset;
    byteOffset += 4; // bytelength
    array.forEach((e) => {
      byteOffset += this.setField(e);
    });
    this.setUint32(start, byteOffset - start - 4, littleEndian); // update length
    return byteOffset - start
  }

  getByteArray(byteOffset) {
    const len = this.getUint32(byteOffset);
    const v = new Uint8Array(this.buffer, byteOffset + 4, len);
    return [v, len + 4]
  }

  setByteArray(byteOffset, data) {
    const len = this.setUint32(byteOffset, data.byteLength);
    const view = new Uint8Array(this.buffer, byteOffset + 4, len);
    view.set(data);
    return data.bytelength + 4
  }
}

class AMQPChannel {
  constructor(connection, id) {
    this.connection = connection;
    this.id = id;
    this.consumers = {};
  }

  close() {
    throw "Not yet implemented"
  }

  // Message is ready to be delivered to consumer
  deliver() {
    const d = this.delivery;
    delete d.bodyPos;
    const c = this.consumers[d.consumerTag];
    this.delivery = null;
    if (c)
      c(d);
    else
      console.error("Consumer", d.consumerTag, "on channel", this.id, "doesn't exists");
  }

  queueBind(queue, exchange, routingKey, args = {}) {
    let j = 0;
    const bind = new AMQPView(new ArrayBuffer(4096));
    bind.setUint8(j, 1); j += 1; // type: method
    bind.setUint16(j, this.id); j += 2; // channel: 1
    bind.setUint32(j, 0); j += 4; // frameSize
    bind.setUint16(j, 50); j += 2; // class: queue
    bind.setUint16(j, 20); j += 2; // method: bind
    bind.setUint16(j, 0); j += 2; // reserved1
    j += bind.setShortString(j, queue);
    j += bind.setShortString(j, exchange);
    j += bind.setShortString(j, routingKey);
    bind.setUint8(j, 0); j += 1; // noWait
    j += bind.setTable(j, args);
    bind.setUint8(j, 206); j += 1; // frame end byte
    bind.setUint32(3, j - 8); // update frameSize
    this.connection.send(new Uint8Array(bind.buffer, 0, j));
    return new Promise((resolve, reject) => {
      this.resolvePromise = () => resolve(this);
      this.rejectPromise = reject;
    })
  }

  queueUnbind(queue, exchange, routingKey, args = {}) {
    let j = 0;
    const unbind = new AMQPView(new ArrayBuffer(4096));
    unbind.setUint8(j, 1); j += 1; // type: method
    unbind.setUint16(j, this.id); j += 2; // channel: 1
    unbind.setUint32(j, 0); j += 4; // frameSize
    unbind.setUint16(j, 50); j += 2; // class: queue
    unbind.setUint16(j, 50); j += 2; // method: unbind
    unbind.setUint16(j, 0); j += 2; // reserved1
    j += unbind.setShortString(j, queue);
    j += unbind.setShortString(j, exchange);
    j += unbind.setShortString(j, routingKey);
    j += unbind.setTable(j, args);
    unbind.setUint8(j, 206); j += 1; // frame end byte
    unbind.setUint32(3, j - 8); // update frameSize
    this.connection.send(new Uint8Array(unbind.buffer, 0, j));
    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    })
  }

  queuePurge(queue) {
    let j = 0;
    const purge = new AMQPView(new ArrayBuffer(512));
    purge.setUint8(j, 1); j += 1; // type: method
    purge.setUint16(j, this.id); j += 2; // channel: 1
    purge.setUint32(j, 0); j += 4; // frameSize
    purge.setUint16(j, 50); j += 2; // class: queue
    purge.setUint16(j, 30); j += 2; // method: purge
    purge.setUint16(j, 0); j += 2; // reserved1
    j += purge.setShortString(j, queue);
    purge.setUint8(j, 1 ); j += 1; // noWait
    purge.setUint8(j, 206); j += 1; // frame end byte
    purge.setUint32(3, j - 8); // update frameSize
    this.connection.send(new Uint8Array(purge.buffer, 0, j));
    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    })
  }

  queueDeclare(name = "", {passive = false, durable = name !== "", autoDelete = name === "", exclusive = name === "", args = {}} = {}) {
    let j = 0;
    const declare = new AMQPView(new ArrayBuffer(4096));
    declare.setUint8(j, 1); j += 1; // type: method
    declare.setUint16(j, this.id); j += 2; // channel: 1
    declare.setUint32(j, 0); j += 4; // frameSize
    declare.setUint16(j, 50); j += 2; // class: queue
    declare.setUint16(j, 10); j += 2; // method: declare
    declare.setUint16(j, 0); j += 2; // reserved1
    j += declare.setShortString(j, name); // name
    let bits = 0;
    if (passive)    bits = bits | (1 << 0);
    if (durable)    bits = bits | (1 << 1);
    if (exclusive)  bits = bits | (1 << 2);
    if (autoDelete) bits = bits | (1 << 3);
    declare.setUint8(j, bits); j += 1;
    j += declare.setTable(j, args); // arguments
    declare.setUint8(j, 206); j += 1; // frame end byte
    declare.setUint32(3, j - 8); // update frameSize
    this.connection.send(new Uint8Array(declare.buffer, 0, j));

    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    })
  }

  queueDelete(name = "", { ifUnused = false, ifEmpty = false } = {}) {
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(512));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel: 1
    frame.setUint32(j, 0); j += 4; // frameSize
    frame.setUint16(j, 50); j += 2; // class: queue
    frame.setUint16(j, 40); j += 2; // method: delete
    frame.setUint16(j, 0); j += 2; // reserved1
    j += frame.setShortString(j, name); // name
    let bits = 0;
    if (ifUnused) bits = bits | (1 << 0);
    if (ifEmpty)  bits = bits | (1 << 1);
    frame.setUint8(j, bits); j += 1;
    frame.setUint8(j, 206); j += 1; // frame end byte
    frame.setUint32(3, j - 8); // update frameSize
    this.connection.send(new Uint8Array(frame.buffer, 0, j));

    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    })
  }

  basicQos(prefetchCount, prefetchSize = 0, global = false) {
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(19));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel: 1
    frame.setUint32(j, 11); j += 4; // frameSize
    frame.setUint16(j, 60); j += 2; // class: basic
    frame.setUint16(j, 10); j += 2; // method: qos
    frame.setUint31(j, prefetchSize); j += 4; // prefetch size
    frame.setUint16(j, prefetchCount); j += 2; // prefetch count
    frame.setUint8(j, global ? 1 : 0); j += 1; // glocal
    frame.setUint8(j, 206); j += 1; // frame end byte
    this.connection.send(new Uint8Array(frame.buffer, 0, 19));
    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    })
  }

  basicConsume(queue, {tag = "", noAck = true, exclusive = false, args = {}} = {}, callback) {
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(4096));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel: 1
    frame.setUint32(j, 0); j += 4; // frameSize
    frame.setUint16(j, 60); j += 2; // class: basic
    frame.setUint16(j, 20); j += 2; // method: consume
    frame.setUint16(j, 0); j += 2; // reserved1
    j += frame.setShortString(j, queue); // queue
    j += frame.setShortString(j, tag); // tag
    let bits = 0;
    if (noAck)     bits = bits | (1 << 1);
    if (exclusive) bits = bits | (1 << 2);
    frame.setUint8(j, bits); j += 1; // noLocal/noAck/exclusive/noWait
    j += frame.setTable(j, args); // arguments table
    frame.setUint8(j, 206); j += 1; // frame end byte
    frame.setUint32(3, j - 8); // update frameSize
    this.connection.send(new Uint8Array(frame.buffer, 0, j));

    return new Promise((resolve, reject) => {
      this.resolvePromise = (consumerTag) => {
        this.consumers[consumerTag] = callback;
        resolve(consumerTag);
      };
      this.rejectPromise = reject;
    })
  }

  basicCancel(tag) {
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(512));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel: 1
    frame.setUint32(j, 0); j += 4; // frameSize
    frame.setUint16(j, 60); j += 2; // class: basic
    frame.setUint16(j, 30); j += 2; // method: cancel
    j += frame.setShortString(j, tag); // tag
    frame.setUint8(j, 0); j += 1; // noWait
    frame.setUint8(j, 206); j += 1; // frame end byte
    frame.setUint32(3, j - 8); // update frameSize
    this.connection.send(new Uint8Array(frame.buffer, 0, j));

    return new Promise((resolve, reject) => {
      this.resolvePromise = (consumerTag) => {
        delete this.consumers[consumerTag];
        resolve(this);
      };
      this.rejectPromise = reject;
    })
  }

  basicAck(deliveryTag, multiple = false) {
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(21));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel
    frame.setUint32(j, 13); j += 4; // frameSize
    frame.setUint16(j, 60); j += 2; // class: basic
    frame.setUint16(j, 80); j += 2; // method: ack
    frame.setUint64(j, deliveryTag); j += 8;
    frame.setUint8(j, multiple ? 1 : 0); j += 1;
    frame.setUint8(j, 206); j += 1; // frame end byte
    this.connection.send(new Uint8Array(frame.buffer, 0, 21));
  }

  basicReject(deliveryTag, requeue = false) {
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(21));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel
    frame.setUint32(j, 13); j += 4; // frameSize
    frame.setUint16(j, 60); j += 2; // class: basic
    frame.setUint16(j, 90); j += 2; // method: reject
    frame.setUint64(j, deliveryTag); j += 8;
    frame.setUint8(j, requeue ? 1 : 0); j += 1;
    frame.setUint8(j, 206); j += 1; // frame end byte
    this.connection.send(new Uint8Array(frame.buffer, 0, 21));
  }

  basicNack(deliveryTag, requeue = false, multiple = false) {
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(21));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel
    frame.setUint32(j, 13); j += 4; // frameSize
    frame.setUint16(j, 60); j += 2; // class: basic
    frame.setUint16(j, 120); j += 2; // method: nack
    frame.setUint64(j, deliveryTag); j += 8;
    let bits = 0;
    if (multiple) bits = bits | (1 << 0);
    if (requeue)  bits = bits | (1 << 1);
    frame.setUint8(j, bits); j += 1;
    frame.setUint8(j, 206); j += 1; // frame end byte
    this.connection.send(new Uint8Array(frame.buffer, 0, 21));
  }

  basicPublish(exchange, routingkey, data, properties) {
    if (data instanceof Uint8Array) ; else if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    } else if (typeof data === "string") {
      const encoder = new TextEncoder();
      data = encoder.encode(data);
    } else {
      const json = JSON.stringify(data);
      const encoder = new TextEncoder();
      data = encoder.encode(json);
    }

    let j = 0;
    let buffer = new AMQPView(new ArrayBuffer(4096));
    buffer.setUint8(j, 1); j += 1; // type: method
    buffer.setUint16(j, this.id); j += 2; // channel
    j += 4; // frame size, update later
    buffer.setUint16(j, 60); j += 2; // class: basic
    buffer.setUint16(j, 40); j += 2; // method: publish
    buffer.setUint16(j, 0); j += 2; // reserved1
    j += buffer.setShortString(j, exchange); // exchange
    j += buffer.setShortString(j, routingkey); // routing key
    buffer.setUint8(j, 0); j += 1; // mandatory/immediate
    buffer.setUint8(j, 206); j += 1; // frame end byte
    buffer.setUint32(3, j - 8); // update frameSize

    const headerStart = j;
    buffer.setUint8(j, 2); j += 1; // type: header
    buffer.setUint16(j, this.id); j += 2; // channel
    j += 4; // frame size, update later
    buffer.setUint16(j, 60); j += 2; // class: basic
    buffer.setUint16(j, 0); j += 2; // weight
    buffer.setUint32(j, 0); j += 4; // bodysize (upper 32 of 64 bits)
    buffer.setUint32(j, data.byteLength); j += 4; // bodysize
    j += buffer.setProperties(j, properties); // properties
    buffer.setUint8(j, 206); j += 1; // frame end byte
    buffer.setUint32(headerStart + 3, j - headerStart - 8); // update frameSize

    // Send current frames if there's no body to send
    if (data.byteLength === 0) {
      this.connection.send(new Uint8Array(buffer.buffer, 0, j));
      return
    }

    // Send current frames if a body frame can't fit in the rest of the frame buffer
    if (j >= 4096 - 8) {
      this.connection.send(new Uint8Array(buffer.buffer, 0, j));
      j = 0;
    }

    // split body into multiple frames if body > frameMax
    for (let bodyPos = 0; bodyPos < data.byteLength;) {
      const frameSize = Math.min(data.byteLength - bodyPos, 4096 - 8 - j); // frame overhead is 8 bytes
      const dataSlice = new Uint8Array(data.buffer, bodyPos, frameSize);

      if (j === 0)
        buffer = new AMQPView(new ArrayBuffer(frameSize + 8));
      buffer.setUint8(j, 3); j += 1; // type: body
      buffer.setUint16(j, this.id); j += 2; // channel
      buffer.setUint32(j, frameSize); j += 4; // frameSize
      const bodyView = new Uint8Array(buffer.buffer, j, frameSize);
      bodyView.set(dataSlice); j += frameSize; // body content
      buffer.setUint8(j, 206); j += 1; // frame end byte
      this.connection.send(new Uint8Array(buffer.buffer, 0, j));
      bodyPos += frameSize;
      j = 0;
    }
    return Promise.resolve(this)
  }

  confirmSelect() {
    let j = 0;
    let frame = new AMQPView(new ArrayBuffer(13));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel
    frame.setUint32(j, 5); // frame size
    frame.setUint16(j, 85); j += 2; // class: confirm
    frame.setUint16(j, 10); j += 2; // method: select
    frame.setUint8(j, 0); j += 1; // no wait
    frame.setUint8(j, 206); j += 1; // frame end byte
    this.connection.send(new Uint8Array(frame.buffer, 0, j));
    
    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    })
  }

  queue(name = "", props = {}) {
    return new Promise((resolve, reject) => {
      this.queueDeclare(name, props)
        .then(({name}) => resolve(new AMQPQueue(this, name)))
        .catch(reject);
    })
  }
}

class AMQPError extends Error {
  constructor(message, connection) {
    super(message);
    this.name = "AMQPError";
    this.connection = connection;
  }
}

class AMQPMessage {
  constructor(channel) {
    this.channel = channel;
  }

  bodyString() {
    const decoder = new TextDecoder();
    return decoder.decode(this.body)
  }

  ack() {
    return this.channel.basicAck(this.deliveryTag)
  }

  nack() {
    return this.channel.basicNack(this.deliveryTag)
  }
}

class AMQPBaseClient {
  constructor(vhost, username, password, name) {
    this.vhost = vhost;
    this.username = username;
    Object.defineProperty(this, 'password', {
      value: password,
      enumerable: false // hide it from console.log etc.
    });
    this.name = name; // connection name
    this.channels = [0];
  }

  connect() {
    throw "Abstract method not implemented"
  }

  send() {
    throw "Abstract method not implemented"
  }

  closeSocket() {
    throw "Abstract method not implemented"
  }

  close({ code = 200, reason = "" } = {}) {
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(512));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, 0); j += 2; // channel: 0
    frame.setUint32(j, 0); j += 4; // frameSize
    frame.setUint16(j, 10); j += 2; // class: connection
    frame.setUint16(j, 50); j += 2; // method: close
    frame.setUint16(j, code); j += 2; // reply code
    j += frame.setShortString(j, reason); // reply reason
    frame.setUint16(j, 0); j += 2; // failing-class-id
    frame.setUint16(j, 0); j += 2; // failing-method-id
    frame.setUint8(j, 206); j += 1; // frame end byte
    frame.setUint32(3, j - 8); // update frameSize
    this.send(new Uint8Array(frame.buffer, 0, j));
  }

  channel(id) {
    return new Promise((resolve, reject) => {
      // Store channels in an array, set position to null when channel is closed
      // Look for first null value or add one the end
      if (!id)
        id = this.channels.findIndex((ch) => ch === undefined);
      if (id === -1) id = this.channels.length;
      const channel = new AMQPChannel(this, id);
      this.channels[id] = channel;
      channel.resolvePromise = resolve;
      channel.rejectPromise = reject;

      let j = 0;
      const channelOpen = new AMQPView(new ArrayBuffer(13));
      channelOpen.setUint8(j, 1); j += 1; // type: method
      channelOpen.setUint16(j, id); j += 2; // channel id
      channelOpen.setUint32(j, 5); j += 4; // frameSize
      channelOpen.setUint16(j, 20); j += 2; // class: channel
      channelOpen.setUint16(j, 10); j += 2; // method: open
      channelOpen.setUint8(j, 0); j += 1; // reserved1
      channelOpen.setUint8(j, 206); j += 1; // frame end byte
      this.send(channelOpen.buffer);
    })
  }

  parseFrames(view) {
    // Can possibly be multiple AMQP frames in a single WS frame
    for (let i = 0; i < view.byteLength;) {
      let j = 0; // position in outgoing frame
      const type = view.getUint8(i); i += 1;
      const channelId = view.getUint16(i); i += 2;
      const frameSize = view.getUint32(i); i += 4;
      switch (type) {
        case 1: { // method
          const classId = view.getUint16(i); i += 2;
          const methodId = view.getUint16(i); i += 2;
          switch (classId) {
            case 10: { // connection
              switch (methodId) {
                case 10: { // start
                  // ignore start frame, just reply startok
                  i += frameSize - 4;

                  const startOk = new AMQPView(new ArrayBuffer(4096));
                  startOk.setUint8(j, 1); j += 1; // type: method
                  startOk.setUint16(j, 0); j += 2; // channel: 0
                  startOk.setUint32(j, 0); j += 4; // frameSize: to be updated
                  startOk.setUint16(j, 10); j += 2; // class: connection
                  startOk.setUint16(j, 11); j += 2; // method: startok
                  let platform = "javascript";
                  if (typeof process !== 'undefined') platform = `${process.release.name} ${process.version} ${process.platform} ${process.arch}`;
                  if (typeof window !== 'undefined')  platform = window.navigator.userAgent;
                  const clientProps = {
                    connection_name: this.name || '',
                    product: "amqp-client.js",
                    information: "https://github.com/cloudamqp/amqp-client.js",
                    version: "1.0.1",
                    platform: platform,
                    capabilities: {
                      "authentication_failure_close": true,
                      "basic.nack": true,
                      "connection.blocked": false,
                      "consumer_cancel_notify": true,
                      "exchange_exchange_bindings": true,
                      "per_consumer_qos": true,
                      "publisher_confirms": true,
                    }
                  };
                  j += startOk.setTable(j, clientProps); // client properties
                  j += startOk.setShortString(j, "PLAIN"); // mechanism
                  const response = `\u0000${this.username}\u0000${this.password}`;
                  j += startOk.setLongString(j, response); // response
                  j += startOk.setShortString(j, ""); // locale
                  startOk.setUint8(j, 206); j += 1; // frame end byte
                  startOk.setUint32(3, j - 8); // update frameSize
                  this.send(new Uint8Array(startOk.buffer, 0, j));
                  break
                }
                case 30: { // tune
                  const channelMax = view.getUint16(i); i += 2;
                  const frameMax = view.getUint32(i); i += 4;
                  const heartbeat = view.getUint16(i); i += 2;
                  this.channelMax = channelMax;
                  this.frameMax = Math.min(4096, frameMax);
                  this.heartbeat = Math.min(0, heartbeat);

                  const tuneOk = new AMQPView(new ArrayBuffer(20));
                  tuneOk.setUint8(j, 1); j += 1; // type: method
                  tuneOk.setUint16(j, 0); j += 2; // channel: 0
                  tuneOk.setUint32(j, 12); j += 4; // frameSize: 12
                  tuneOk.setUint16(j, 10); j += 2; // class: connection
                  tuneOk.setUint16(j, 31); j += 2; // method: tuneok
                  tuneOk.setUint16(j, this.channelMax); j += 2; // channel max
                  tuneOk.setUint32(j, this.frameMax); j += 4; // frame max
                  tuneOk.setUint16(j, this.heartbeat); j += 2; // heartbeat
                  tuneOk.setUint8(j, 206); j += 1; // frame end byte
                  this.send(new Uint8Array(tuneOk.buffer, 0, j));

                  j = 0;
                  const open = new AMQPView(new ArrayBuffer(512));
                  open.setUint8(j, 1); j += 1; // type: method
                  open.setUint16(j, 0); j += 2; // channel: 0
                  open.setUint32(j, 0); j += 4; // frameSize: to be updated
                  open.setUint16(j, 10); j += 2; // class: connection
                  open.setUint16(j, 40); j += 2; // method: open
                  j += open.setShortString(j, this.vhost); // vhost
                  open.setUint8(j, 0); j += 1; // reserved1
                  open.setUint8(j, 0); j += 1; // reserved2
                  open.setUint8(j, 206); j += 1; // frame end byte
                  open.setUint32(3, j - 8); // update frameSize
                  this.send(new Uint8Array(open.buffer, 0, j));

                  break
                }
                case 41: { // openok
                  i += 1; // reserved1
                  this.resolvePromise(this);
                  break
                }
                case 50: { // close
                  const code = view.getUint16(i); i += 2;
                  const [text, strLen] = view.getShortString(i); i += strLen;
                  const classId = view.getUint16(i); i += 2;
                  const methodId = view.getUint16(i); i += 2;
                  console.debug("connection closed by server", code, text, classId, methodId);

                  const closeOk = new AMQPView(new ArrayBuffer(12));
                  closeOk.setUint8(j, 1); j += 1; // type: method
                  closeOk.setUint16(j, 0); j += 2; // channel: 0
                  closeOk.setUint32(j, 4); j += 4; // frameSize
                  closeOk.setUint16(j, 10); j += 2; // class: connection
                  closeOk.setUint16(j, 51); j += 2; // method: closeok
                  closeOk.setUint8(j, 206); j += 1; // frame end byte
                  this.send(new Uint8Array(closeOk.buffer, 0, j));
                  const msg = `connection closed: ${text} (${code})`;
                  this.rejectPromise(new AMQPError(msg, this));

                  this.closeSocket();
                  break
                }
                case 51: { // closeOk
                  this.closeSocket();
                  break
                }
                default:
                  i += frameSize - 4;
                  console.error("unsupported class/method id", classId, methodId);
              }
              break
            }
            case 20: { // channel
              switch (methodId) {
                case 11: { // openok
                  i += 4; // reserved1 (long string)
                  const channel = this.channels[channelId];
                  channel.resolvePromise(channel);
                  break
                }
                case 40: { // close
                  const code = view.getUint16(i); i += 2;
                  const [text, strLen] = view.getShortString(i); i += strLen;
                  const classId = view.getUint16(i); i += 2;
                  const methodId = view.getUint16(i); i += 2;

                  console.debug("channel", channelId, "closed", code, text, classId, methodId);
                  const closeOk = new AMQPView(new ArrayBuffer(12));
                  closeOk.setUint8(j, 1); j += 1; // type: method
                  closeOk.setUint16(j, channelId); j += 2; // channel
                  closeOk.setUint32(j, 4); j += 4; // frameSize
                  closeOk.setUint16(j, 20); j += 2; // class: channel
                  closeOk.setUint16(j, 41); j += 2; // method: closeok
                  closeOk.setUint8(j, 206); j += 1; // frame end byte
                  this.send(new Uint8Array(closeOk.buffer, 0, j));

                  const channel = this.channels[channelId];
                  if (channel) {
                    const msg = `channel ${channelId} closed: ${text} (${code})`;
                    channel.rejectPromise(new AMQPError(msg, this));
                    delete this.channels[channelId];
                  } else {
                    console.warn("channel", channelId, "already closed");
                  }

                  break
                }
                default:
                  i += frameSize - 4; // skip rest of frame
                  console.error("unsupported class/method id", classId, methodId);
              }
              break
            }
            case 50: { // queue
              switch (methodId) {
                case 11: { // declareOk
                  const [name, strLen] = view.getShortString(i); i += strLen;
                  const messageCount = view.getUint32(i); i += 4;
                  const consumerCount = view.getUint32(i); i += 4;
                  const channel = this.channels[channelId];
                  channel.resolvePromise({ name, messageCount, consumerCount });
                  break
                }
                case 21: { // bindOk
                  const channel = this.channels[channelId];
                  channel.resolvePromise();
                  break
                }
                case 31: { // purgeOk
                  const messageCount = view.getUint32(i); i += 4;
                  const channel = this.channels[channelId];
                  channel.resolvePromise({ messageCount });
                  break
                }
                case 41: { // deleteOk
                  const messageCount = view.getUint32(i); i += 4;
                  const channel = this.channels[channelId];
                  channel.resolvePromise({ messageCount });
                  break
                }
                case 51: { // unbindOk
                  const channel = this.channels[channelId];
                  channel.resolvePromise();
                  break
                }
                default:
                  i += frameSize - 4;
                  console.error("unsupported class/method id", classId, methodId);
              }
              break
            }
            case 60: { // basic
              switch (methodId) {
                case 11: { // qosOk
                  const channel = this.channels[channelId];
                  channel.resolvePromise();
                  break
                }
                case 21: { // consumeOk
                  const [ consumerTag, len ] = view.getShortString(i); i += len;
                  const channel = this.channels[channelId];
                  channel.resolvePromise(consumerTag);
                  break
                }
                case 31: { // cancelOk
                  const [consumerTag, len] = view.getShortString(i); i += len;
                  const channel = this.channels[channelId];
                  channel.resolvePromise(consumerTag);
                  break
                }
                case 60: { // deliver
                  const [ consumerTag, consumerTagLen ] = view.getShortString(i); i += consumerTagLen;
                  const deliveryTag = view.getUint64(i); i += 8;
                  const redeliviered = view.getUint8(i) === 1; i += 1;
                  const [ exchange, exchangeLen ]= view.getShortString(i); i += exchangeLen;
                  const [ routingKey, routingKeyLen ]= view.getShortString(i); i += routingKeyLen;
                  const channel = this.channels[channelId];
                  if (!channel) {
                    console.warn("Cannot deliver to closed channel", channelId);
                    return
                  }
                  const message = new AMQPMessage(channel);
                  message.consumerTag = consumerTag;
                  message.deliveryTag = deliveryTag;
                  message.exchange = exchange;
                  message.routingKey = routingKey;
                  message.redeliviered = redeliviered;
                  channel.delivery = message;
                  break
                }
                default:
                  i += frameSize - 4;
                  console.error("unsupported class/method id", classId, methodId);
              }
              break
            }
            case 85: { // confirm
              switch (methodId) {
                case 11: { // selectOk
                  const channel = this.channels[channelId];
                  channel.resolvePromise();
                  break
                }
              }
              break
            }
            default:
              i += frameSize - 2;
              console.error("unsupported class id", classId);
          }
          break
        }
        case 2: { // header
          i += 2; // ignoring class id
          i += 2; // ignoring weight
          const bodySize = view.getUint64(i); i += 8;
          const [properties, propLen] = view.getProperties(i); i += propLen;

          const channel = this.channels[channelId];
          if (!channel) {
            console.warn("Cannot deliver to closed channel", channelId);
            break
          }
          const delivery = channel.delivery;
          delivery.bodySize = bodySize;
          delivery.properties = properties;
          delivery.body = new Uint8Array(bodySize);
          delivery.bodyPos = 0; // if body is split over multiple frames
          if (bodySize === 0)
            channel.deliver();
          break
        }
        case 3: { // body
          const channel = this.channels[channelId];
          if (!channel) {
            console.warn("Cannot deliver to closed channel", channelId);
            break
          }
          const delivery = channel.delivery;
          const bodyPart = new Uint8Array(view.buffer, i, frameSize);
          delivery.body.set(bodyPart, delivery.bodyPos);
          delivery.bodyPos += frameSize;
          i += frameSize;
          if (delivery.bodyPos === delivery.bodySize)
            channel.deliver();
          break
        }
        case 8: { // heartbeat
          const heartbeat = new AMQPView(new ArrayBuffer(8));
          heartbeat.setUint8(j, 1); j += 1; // type: method
          heartbeat.setUint16(j, 0); j += 2; // channel: 0
          heartbeat.setUint32(j, 0); j += 4; // frameSize
          heartbeat.setUint8(j, 206); j += 1; // frame end byte
          this.send(new Uint8Array(heartbeat.buffer, 0, j));
          break
        }
        default:
          console.error("invalid frame type:", type);
          i += frameSize;
      }
      const frameEnd = view.getUint8(i); i += 1;
      if (frameEnd != 206)
        console.error("Invalid frame end", frameEnd);
    }
  }
}

class AMQPWebSocketClient extends AMQPBaseClient {
  constructor(url, vhost, username, password, name) {
    super(vhost, username, password, name);
    this.url = url;
  }

  connect() {
    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
      socket.onclose = reject;
      socket.onerror = reject;
      socket.onopen = () => {
        const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]);
        socket.send(amqpstart);
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const view = new AMQPView(event.data);
          this.parseFrames(view);
        } else {
          socket.close();
          reject("invalid data on socket");
        }
      };
    })
  }

  send(bytes) {
    return this.socket.send(bytes)
  }

  closeSocket() {
    this.socket.close();
  }
}

export default AMQPWebSocketClient;
