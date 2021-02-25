class AMQPError extends Error {
  constructor(message, connection) {
    super(message);
    this.name = "AMQPError";
    this.connection = connection;
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
        .then(resolve)
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

class AMQPConsumer {
  constructor(channel, tag, onMessage) {
    this.channel = channel;
    this.tag = tag;
    this.onMessage = onMessage;
  }

  setClosed(err) {
    this.closed = true;
    this.closedError = err;
    clearTimeout(this.timeoutId);
    if (err) {
      if (this.rejectWait) this.rejectWait(err);
    } else {
      if (this.resolveWait) this.resolveWait();
    }
  }

  cancel() {
    return this.channel.basicCancel(this.tag)
  }

  /** Wait for the consumer to finish
    * Returns a Promise that
    * resolves if the consumer/channel/connection is closed by the client
    * rejects if the server closed or there was a network error */
  wait(timeout) {
    if (this.closedError) return Promise.reject(this.closedError)
    if (this.closed) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.resolveWait = resolve;
      this.rejectWait = reject;
      if (timeout) {
        const onTimeout = () => reject(new AMQPError("Timeout", this.channel.connection));
        this.timeoutId = setTimeout(onTimeout, timeout);
      }
    })
  }
}

class AMQPChannel {
  constructor(connection, id) {
    this.connection = connection;
    this.id = id;
    this.consumers = {};
    this.promises = [];
    this.unconfirmedPublishes = [];
    this.closed = false;
  }

  resolvePromise(value) {
    if (this.promises.length === 0) return false
    const [resolve, ] = this.promises.shift();
    resolve(value);
    return true
  }

  rejectPromise(err) {
    if (this.promises.length === 0) return false
    const [, reject] = this.promises.shift();
    reject(err);
    return true
  }

  sendRpc(frame, frameSize) {
    return new Promise((resolve, reject) => {
      this.connection.send(new Uint8Array(frame.buffer, 0, frameSize))
        .then(() => this.promises.push([resolve, reject]))
        .catch(reject);
    })
  }

  setClosed(err) {
    if (!this.closed) {
      this.closed = true;
      // Close all consumers
      Object.values(this.consumers).forEach((consumer) => consumer.setClosed(err));
      this.consumers = []; // Empty consumers
      // Empty and reject all RPC promises
      while(this.rejectPromise(err)) { }
    }
  }

  rejectClosed() {
    return Promise.reject(new AMQPError("Channel is closed", this.connection))
  }

  publishConfirmed(deliveryTag, multiple, nack) {
    // is queueMicrotask() needed here?
    const idx = this.unconfirmedPublishes.findIndex(([tag,]) => tag === deliveryTag);
    if (idx !== -1) {
      const confirmed = multiple ?
        this.unconfirmedPublishes.splice(0, idx + 1) :
        this.unconfirmedPublishes.splice(idx, 1);
      confirmed.forEach(([tag, resolve, reject]) => {
        if (nack)
          reject(new Error("Message rejected"));
        else
          resolve(tag);
      });
    } else {
      console.warn("Cant find unconfirmed deliveryTag", deliveryTag, "multiple:", multiple, "nack:", nack);
    }
  }

  onReturn(message) {
    console.error("Message returned from server", message);
    this.returned = null;
  }

  close({ code = 200, reason = "" } = {}) {
    if (this.closed) return this.rejectClosed()
    this.closed = true;
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(512));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel
    frame.setUint32(j, 0); j += 4; // frameSize
    frame.setUint16(j, 20); j += 2; // class: channel
    frame.setUint16(j, 40); j += 2; // method: close
    frame.setUint16(j, code); j += 2; // reply code
    j += frame.setShortString(j, reason); // reply reason
    frame.setUint16(j, 0); j += 2; // failing-class-id
    frame.setUint16(j, 0); j += 2; // failing-method-id
    frame.setUint8(j, 206); j += 1; // frame end byte
    frame.setUint32(3, j - 8); // update frameSize
    return this.sendRpc(frame, j)
  }

  // Message is ready to be delivered to consumer
  deliver(msg) {
    this.delivery = null;
    queueMicrotask(() => { // Enqueue microtask to avoid race condition with ConsumeOk
      const consumer = this.consumers[msg.consumerTag];
      if (consumer) {
        consumer.onMessage(msg);
      } else {
        console.error("Consumer", msg.consumerTag, "on channel", this.id, "doesn't exists");
      }
    });
  }

  queueBind(queue, exchange, routingKey, args = {}) {
    if (this.closed) return this.rejectClosed()
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
    return this.sendRpc(bind, j)
  }

  queueUnbind(queue, exchange, routingKey, args = {}) {
    if (this.closed) return this.rejectClosed()
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
    return this.sendRpc(unbind, j)
  }

  queuePurge(queue) {
    if (this.closed) return this.rejectClosed()
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
    return this.sendRpc(purge, j)
  }

  queueDeclare(name = "", {passive = false, durable = name !== "", autoDelete = name === "", exclusive = name === "", args = {}} = {}) {
    if (this.closed) return this.rejectClosed()
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
    return this.sendRpc(declare, j)
  }

  queueDelete(name = "", { ifUnused = false, ifEmpty = false } = {}) {
    if (this.closed) return this.rejectClosed()
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
    return this.sendRpc(frame, j)
  }

  basicQos(prefetchCount, prefetchSize = 0, global = false) {
    if (this.closed) return this.rejectClosed()
    let j = 0;
    const frame = new AMQPView(new ArrayBuffer(19));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel: 1
    frame.setUint32(j, 11); j += 4; // frameSize
    frame.setUint16(j, 60); j += 2; // class: basic
    frame.setUint16(j, 10); j += 2; // method: qos
    frame.setUint32(j, prefetchSize); j += 4; // prefetch size
    frame.setUint16(j, prefetchCount); j += 2; // prefetch count
    frame.setUint8(j, global ? 1 : 0); j += 1; // glocal
    frame.setUint8(j, 206); j += 1; // frame end byte
    return this.sendRpc(frame, j)
  }

  basicConsume(queue, {tag = "", noAck = true, exclusive = false, args = {}} = {}, callback) {
    if (this.closed) return this.rejectClosed()
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

    return new Promise((resolve, reject) => {
      this.sendRpc(frame, j).then((consumerTag) =>  {
        const consumer = new AMQPConsumer(this, consumerTag, callback);
        this.consumers[consumerTag] = consumer;
        resolve(consumer);
      }).catch(reject);
    })
  }

  basicCancel(tag) {
    if (this.closed) return this.rejectClosed()
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

    return new Promise((resolve, reject) => {
      this.sendRpc(frame, j).then((consumerTag) => {
        const consumer = this.consumers[consumerTag];
        consumer.setClosed();
        delete this.consumers[consumerTag];
        resolve(this);
      }).catch(reject);
    })
  }

  basicAck(deliveryTag, multiple = false) {
    if (this.closed) return this.rejectClosed()
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
    return this.connection.send(new Uint8Array(frame.buffer, 0, 21))
  }

  basicReject(deliveryTag, requeue = false) {
    if (this.closed) return this.rejectClosed()
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
    return this.connection.send(new Uint8Array(frame.buffer, 0, 21))
  }

  basicNack(deliveryTag, requeue = false, multiple = false) {
    if (this.closed) return this.rejectClosed()
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
    return this.connection.send(new Uint8Array(frame.buffer, 0, 21))
  }

  basicPublish(exchange, routingkey, data, properties, mandatory, immediate) {
    if (this.closed) return this.rejectClosed()
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

    const promises = [];
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
    let bits = 0;
    if (mandatory) bits = bits | (1 << 0);
    if (immediate) bits = bits | (1 << 1);
    buffer.setUint8(j, bits); j += 1; // mandatory/immediate
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
      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j));
      promises.push(p);
      return
    }

    // Send current frames if a body frame can't fit in the rest of the frame buffer
    if (j >= 4096 - 8) {
      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j));
      promises.push(p);
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
      const p = this.connection.send(new Uint8Array(buffer.buffer, 0, j));
      promises.push(p);
      bodyPos += frameSize;
      j = 0;
    }
    // if publish confirm is enabled, put a promise on a queue if the sends were ok
    // the promise on the queue will be fullfilled by the read loop when an ack/nack
    // comes from the server
    if (this.confirmId !== undefined) {
      return new Promise((resolve, reject) =>
        Promise.all(promises)
          .then(() => this.unconfirmedPublishes.push([++this.confirmId, resolve, reject]))
          .catch(reject)
      )
    } else {
      return new Promise((resolve, reject) =>
        Promise.all(promises)
          .then(() => resolve(0))
          .catch(reject))
    }
  }

  confirmSelect() {
    if (this.closed) return this.rejectClosed()
    let j = 0;
    let frame = new AMQPView(new ArrayBuffer(13));
    frame.setUint8(j, 1); j += 1; // type: method
    frame.setUint16(j, this.id); j += 2; // channel
    frame.setUint32(j, 5); j += 4; // frame size
    frame.setUint16(j, 85); j += 2; // class: confirm
    frame.setUint16(j, 10); j += 2; // method: select
    frame.setUint8(j, 0); j += 1; // no wait
    frame.setUint8(j, 206); j += 1; // frame end byte
    return this.sendRpc(frame, j) // parseFrames in base will set channel.confirmId = 0
  }

  queue(name = "", props = {}) {
    return new Promise((resolve, reject) => {
      this.queueDeclare(name, props)
        .then(({name}) => resolve(new AMQPQueue(this, name)))
        .catch(reject);
    })
  }

  prefetch(prefetchCount) {
    return this.basicQos(prefetchCount)
  }
}

class AMQPMessage {
  constructor(channel) {
    this.channel = channel;
  }

  bodyToString() {
    const decoder = new TextDecoder();
    return decoder.decode(this.body)
  }

  /** Alias for bodyToString()
  */
  bodyString() {
    return this.bodyToString()
  }

  ack(multiple = false) {
    return this.channel.basicAck(this.deliveryTag, multiple)
  }

  reject(requeue = false) {
    return this.channel.basicReject(this.deliveryTag, requeue)
  }

  nack(requeue = false, multiple = false) {
    return this.channel.basicNack(this.deliveryTag, requeue, multiple)
  }
}

const VERSION = '1.0.7';

class AMQPBaseClient {
  constructor(vhost, username, password, name, platform) {
    this.vhost = vhost;
    this.username = username;
    Object.defineProperty(this, 'password', {
      value: password,
      enumerable: false // hide it from console.log etc.
    });
    this.name = name; // connection name
    this.platform = platform;
    this.channels = [new AMQPChannel(this, 0)];
    this.closed = false;
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

  rejectClosed() {
    return Promise.reject(new AMQPError("Connection closed", this))
  }

  rejectConnect(err) {
    const [, reject] = this.connectPromise;
    delete this.connectPromise;
    reject(err);
    this.closed = true;
    this.closeSocket();
  }

  close({ code = 200, reason = "" } = {}) {
    if (this.closed) return this.rejectClosed()
    this.closed = true;
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
    return new Promise((resolve, reject) => {
      this.send(new Uint8Array(frame.buffer, 0, j))
        .then(() => this.closePromise = [resolve, reject])
        .catch(reject);
    })
  }

  channel(id) {
    if (this.closed) return this.rejectClosed()
    // Store channels in an array, set position to null when channel is closed
    // Look for first null value or add one the end
    if (!id)
      id = this.channels.findIndex((ch) => ch === undefined);
    if (id === -1) id = this.channels.length;
    const channel = new AMQPChannel(this, id);
    this.channels[id] = channel;

    let j = 0;
    const channelOpen = new AMQPView(new ArrayBuffer(13));
    channelOpen.setUint8(j, 1); j += 1; // type: method
    channelOpen.setUint16(j, id); j += 2; // channel id
    channelOpen.setUint32(j, 5); j += 4; // frameSize
    channelOpen.setUint16(j, 20); j += 2; // class: channel
    channelOpen.setUint16(j, 10); j += 2; // method: open
    channelOpen.setUint8(j, 0); j += 1; // reserved1
    channelOpen.setUint8(j, 206); j += 1; // frame end byte
    return new Promise((resolve, reject) => {
      this.send(channelOpen.buffer)
        .then(() => channel.promises.push([resolve, reject]))
        .catch(reject);
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
                  const clientProps = {
                    connection_name: this.name,
                    product: "amqp-client.js",
                    information: "https://github.com/cloudamqp/amqp-client.js",
                    version: VERSION,
                    platform: this.platform,
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
                  if (!this.name) delete clientProps["connection_name"];
                  j += startOk.setTable(j, clientProps); // client properties
                  j += startOk.setShortString(j, "PLAIN"); // mechanism
                  const response = `\u0000${this.username}\u0000${this.password}`;
                  j += startOk.setLongString(j, response); // response
                  j += startOk.setShortString(j, ""); // locale
                  startOk.setUint8(j, 206); j += 1; // frame end byte
                  startOk.setUint32(3, j - 8); // update frameSize
                  this.send(new Uint8Array(startOk.buffer, 0, j)).catch(this.rejectConnect);
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
                  this.send(new Uint8Array(tuneOk.buffer, 0, j)).catch(this.rejectConnect);

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
                  this.send(new Uint8Array(open.buffer, 0, j)).catch(this.rejectConnect);

                  break
                }
                case 41: { // openok
                  i += 1; // reserved1
                  const [resolve, ] = this.connectPromise;
                  delete this.connectPromise;
                  resolve(this);
                  break
                }
                case 50: { // close
                  const code = view.getUint16(i); i += 2;
                  const [text, strLen] = view.getShortString(i); i += strLen;
                  const classId = view.getUint16(i); i += 2;
                  const methodId = view.getUint16(i); i += 2;
                  console.debug("connection closed by server", code, text, classId, methodId);

                  this.closed = true;
                  const msg = `connection closed: ${text} (${code})`;
                  const err = new AMQPError(msg, this);
                  this.channels.forEach((ch) => ch.setClosed(err));
                  this.channels = [];
                  if (this.connectPromise) {
                    this.rejectConnect(err);
                  }

                  const closeOk = new AMQPView(new ArrayBuffer(12));
                  closeOk.setUint8(j, 1); j += 1; // type: method
                  closeOk.setUint16(j, 0); j += 2; // channel: 0
                  closeOk.setUint32(j, 4); j += 4; // frameSize
                  closeOk.setUint16(j, 10); j += 2; // class: connection
                  closeOk.setUint16(j, 51); j += 2; // method: closeok
                  closeOk.setUint8(j, 206); j += 1; // frame end byte
                  this.send(new Uint8Array(closeOk.buffer, 0, j))
                    .then(() => this.closeSocket())
                    .catch(err => console.warn("Error while sending Connection#CloseOk", err));
                  break
                }
                case 51: { // closeOk
                  this.channels.forEach((ch) => ch.setClosed());
                  this.channels = [];
                  const [resolve, ] = this.closePromise;
                  delete this.closePromise;
                  resolve();
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

                  const channel = this.channels[channelId];
                  if (channel) {
                    const msg = `channel ${channelId} closed: ${text} (${code})`;
                    const err = new AMQPError(msg, this);
                    channel.setClosed(err);
                    delete this.channels[channelId];
                  } else {
                    console.warn("channel", channelId, "already closed");
                  }

                  const closeOk = new AMQPView(new ArrayBuffer(12));
                  closeOk.setUint8(j, 1); j += 1; // type: method
                  closeOk.setUint16(j, channelId); j += 2; // channel
                  closeOk.setUint32(j, 4); j += 4; // frameSize
                  closeOk.setUint16(j, 20); j += 2; // class: channel
                  closeOk.setUint16(j, 41); j += 2; // method: closeok
                  closeOk.setUint8(j, 206); j += 1; // frame end byte
                  this.send(new Uint8Array(closeOk.buffer, 0, j))
                    .catch(err => console.error("Error while sending Channel#closeOk", err));
                  break
                }
                case 41: { // closeOk
                  const channel = this.channels[channelId];
                  if (channel) {
                    channel.setClosed();
                    delete this.channels[channelId];
                    channel.resolvePromise();
                  } else {
                    this.rejectPromise(`channel ${channelId} already closed`);
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
                case 50: { // return
                  const code = view.getUint16(i); i += 2;
                  const [text, len] = view.getShortString(i); i += len;
                  const [exchange, exchangeLen] = view.getShortString(i); i += exchangeLen;
                  const [routingKey, routingKeyLen] = view.getShortString(i); i += routingKeyLen;
                  const channel = this.channels[channelId];
                  if (!channel) {
                    console.warn("Cannot return to closed channel", channelId);
                    break
                  }
                  channel.returned = {
                    replyCode: code,
                    replyText: text,
                    exchange: exchange,
                    routingKey: routingKey,
                  };
                  break
                }
                case 60: { // deliver
                  const [ consumerTag, consumerTagLen ] = view.getShortString(i); i += consumerTagLen;
                  const deliveryTag = view.getUint64(i); i += 8;
                  const redelivered = view.getUint8(i) === 1; i += 1;
                  const [ exchange, exchangeLen ]= view.getShortString(i); i += exchangeLen;
                  const [ routingKey, routingKeyLen ]= view.getShortString(i); i += routingKeyLen;
                  const channel = this.channels[channelId];
                  if (!channel) {
                    console.warn("Cannot deliver to closed channel", channelId);
                    break
                  }
                  const message = new AMQPMessage(channel);
                  message.consumerTag = consumerTag;
                  message.deliveryTag = deliveryTag;
                  message.exchange = exchange;
                  message.routingKey = routingKey;
                  message.redelivered = redelivered;
                  channel.delivery = message;
                  break
                }
                case 80: { // confirm ack
                  const deliveryTag = view.getUint64(i); i += 8;
                  const multiple = view.getUint8(i) === 1; i += 1;
                  const channel = this.channels[channelId];
                  if (!channel) {
                    console.warn("Got publish confirm ack for closed channel", channelId);
                    break
                  }
                  channel.publishConfirmed(deliveryTag, multiple, false);
                  break
                }
                case 120: { // confirm nack
                  const deliveryTag = view.getUint64(i); i += 8;
                  const multiple = view.getUint8(i) === 1; i += 1;
                  const channel = this.channels[channelId];
                  if (!channel) {
                    console.warn("Got publish confirm nack for closed channel", channelId);
                    break
                  }
                  channel.publishConfirmed(deliveryTag, multiple, true);
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
                  channel.confirmId = 0;
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
          const message = channel.delivery || channel.returned;
          message.bodySize = bodySize;
          message.properties = properties;
          message.body = new Uint8Array(bodySize);
          message.bodyPos = 0; // if body is split over multiple frames
          if (bodySize === 0)
            channel.delivery ? channel.deliver(message) : channel.onReturn(message);
          break
        }
        case 3: { // body
          const channel = this.channels[channelId];
          if (!channel) {
            console.warn("Cannot deliver to closed channel", channelId);
            i += frameSize;
            break
          }
          const message = channel.delivery || channel.returned;
          const bodyPart = new Uint8Array(view.buffer, i, frameSize);
          message.body.set(bodyPart, message.bodyPos);
          message.bodyPos += frameSize;
          i += frameSize;
          if (message.bodyPos === message.bodySize)
            channel.delivery ? channel.deliver(message) : channel.onReturn(message);
          break
        }
        case 8: { // heartbeat
          const heartbeat = new AMQPView(new ArrayBuffer(8));
          heartbeat.setUint8(j, 1); j += 1; // type: method
          heartbeat.setUint16(j, 0); j += 2; // channel: 0
          heartbeat.setUint32(j, 0); j += 4; // frameSize
          heartbeat.setUint8(j, 206); j += 1; // frame end byte
          this.send(new Uint8Array(heartbeat.buffer, 0, j))
            .catch(err => console.warn("Error while sending heartbeat", err));
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
  constructor(url, vhost = "/", username = "guest", password = "guest", name = undefined) {
    super(vhost, username, password, name, window.navigator.userAgent);
    this.url = url;
  }

  connect() {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onmessage = (event) => this.parseFrames(new AMQPView(event.data));
    return new Promise((resolve, reject) => {
      this.connectPromise = [resolve, reject];
      socket.onclose = reject;
      socket.onerror = reject;
      socket.onopen = () => {
        const amqpstart = new Uint8Array([65, 77, 81, 80, 0, 0, 9, 1]);
        socket.send(amqpstart);
      };
    })
  }

  send(bytes) {
    return new Promise((resolve, reject) => {
      try {
        this.socket.send(bytes);
        resolve();
      } catch (err) {
        reject(err);
      }
    })
  }

  closeSocket() {
    this.socket.close();
  }
}

export default AMQPWebSocketClient;
