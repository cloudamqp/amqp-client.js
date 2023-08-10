import { assert, expect, test, beforeEach, vi } from "vitest";
import { AMQPWebSocketClient } from '../src/amqp-websocket-client.js';
import { AMQPMessage } from '../src/amqp-message.js';
import type { AMQPError } from "../src/amqp-error.js";

function getNewClient(init?: {frameMax?: number, heartbeat?: number}): AMQPWebSocketClient {
  return init 
    ? new AMQPWebSocketClient({ url: "ws://127.0.0.1:15670/ws/amqp", ...init })
    : new AMQPWebSocketClient("ws://127.0.0.1:15670/ws/amqp")
}

beforeEach(() => {
  expect.hasAssertions()
})

test('can parse the url correctly', () => {
  const username = 'user_name'
  const password = 'passwd'
  const hostname = '127.0.0.1'
  const port = 15670
  const vhost = 'my_host'
  const name = 'test'
  const client = new AMQPWebSocketClient({ url: `ws://${hostname}:${port}/ws/amqp`, username: username, password: password, vhost: vhost, name: name });
  expect(client.username).toEqual(username);
  expect(client.password).toEqual(password);
  expect(client.vhost).toEqual(vhost);
  expect(client.name).toEqual(name);
})

test('can open a connection and a channel', () => {
  const amqp = getNewClient()
  return amqp.connect()
    .then((conn) => conn.channel())
    .then((ch) => expect(ch.connection.channels.length).toEqual(2)) // 2 because channel 0 is counted
})

test('can publish and consume', () => {
  const amqp = getNewClient()
  return new Promise<AMQPMessage>((resolve, reject) => {
    amqp.connect()
      .then(conn => conn.channel())
      .then(ch => ch.queue(""))
      .then(q => q.publish("hello world"))
      .then(q => q.subscribe({noAck: false}, msg => {
        msg.ack()
        resolve(msg)
      }))
      .catch(reject)
  }).then((result: AMQPMessage) => expect(result.bodyString()).toEqual("hello world"))
})

test('can nack a message', () => {
  const amqp = getNewClient()
  return new Promise<AMQPMessage>((resolve, reject) => {
    amqp.connect()
      .then(conn => conn.channel())
      .then(ch => ch.queue(""))
      .then(q => q.publish("hello world"))
      .then(q => q.subscribe({noAck: false}, msg => {
        msg.nack()
        resolve(msg)
      }))
      .catch(reject)
  }).then((result: AMQPMessage) => expect(result.bodyString()).toEqual("hello world"))
})

test('can reject a message', () => {
  const amqp = getNewClient()
  return new Promise<AMQPMessage>((resolve, reject) => {
    amqp.connect()
      .then(conn => conn.channel())
      .then(ch => ch.queue(""))
      .then(q => q.publish("hello world"))
      .then(q => q.subscribe({noAck: false}, msg => {
        msg.reject()
        resolve(msg)
      }))
      .catch(reject)
  }).then((result: AMQPMessage) => expect(result.bodyString()).toEqual("hello world"))
})

test('can unbind a queue from exchange', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  await q.bind("amq.topic", "asd")
  await expect(q.unbind("amq.topic", "asd")).resolves.toBeDefined()
})

test('can unsubscribe from a queue', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({}, () => "")
  await expect(q.unsubscribe(consumer.tag)).resolves.toBeDefined()
})

test("can delete a queue", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  await expect(q.delete()).resolves.toBeDefined()
})

test("can get message from a queue", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  await q.publish("message")
  const msg = await q.get({noAck: true})
  expect((msg as AMQPMessage).bodyString()).toEqual("message")
})

test('will throw an error', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await expect(ch.queue("amq.foobar")).rejects.toThrow(/ACCESS_REFUSED/)
})

test('will throw an error after consumer timeout', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({noAck: false}, () => "")
  await expect(consumer.wait(1)).rejects.toThrow()
})

test('will throw an error if consumer is closed', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({noAck: false}, () => "")
  consumer.setClosed(new Error("testing"))
  try {
    await consumer.wait(1);
  } catch (error) {
    expect((error as Error).message).toEqual("testing")
  }
})

test('can cancel a consumer', () => {
  const amqp = getNewClient()
  return amqp.connect()
    .then((conn) => conn.channel())
    .then((ch) => ch.queue(""))
    .then((q) => q.subscribe({noAck: false}, console.log))
    .then((consumer) => consumer.cancel())
    .then((channel) => expect(channel.consumers.size).toEqual(0))
})

test('will clear consumer wait timeout on cancel', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({noAck: false}, () => "")
  const wait = consumer.wait(5000);
  consumer.cancel()
  await expect(wait).resolves.toBeUndefined()
})

test('can close a channel', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await ch.close()
  await expect(ch.close()).rejects.toThrow('Channel is closed')
})

test('connection error raises everywhere', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await conn.close()
  await expect(ch.close()).rejects.toThrow(/Channel is closed/)
})

test('consumer stops wait on cancel', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  const consumer = await q.subscribe({}, () => ({}))
  await q.publish("foobar")
  await consumer.cancel()
  await expect(consumer.wait()).resolves.toBeUndefined()
})

test('consumer stops wait on channel error', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  const consumer = await q.subscribe({}, () => ({}))
  // acking invalid delivery tag should close channel
  setTimeout(() => ch.basicAck(99999), 1)
  await expect(consumer.wait()).rejects.toThrow()
})

test('connection error raises on publish', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await conn.close()
  await expect(q.publish("foobar")).rejects.toThrow()
})

test('closed socket closes client', async () => {
  const amqp = getNewClient()
  await amqp.connect()
  const socket = amqp["socket"]
  assert(socket, "Socket must be created")
  const closed = new Promise((resolve) => socket.addEventListener('close', resolve))
  socket.close()
  await closed
  expect(amqp.closed).toBe(true)
})

test('wait for publish confirms', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  let tag

  // publishes without confirm should return 0
  tag = await ch.basicPublish("amq.fanout", "rk", "body")
  expect(tag).toEqual(0)
  tag = await ch.basicPublish("amq.fanout", "rk", "body")
  expect(tag).toEqual(0)

  // publishes with confirm should return the delivery tag id
  await ch.confirmSelect()
  tag = await ch.basicPublish("amq.fanout", "rk", "body")
  expect(tag).toEqual(1)
  tag = await ch.basicPublish("amq.fanout", "rk", "body")
  expect(tag).toEqual(2)

  // can wait for multiple tags
  const tags = await Promise.all([
    ch.basicPublish("amq.fanout", "rk", "body"),
    ch.basicPublish("amq.fanout", "rk", "body")
  ])
  expect(tags).toEqual([3,4])
})

test('can handle returned messages', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()

  const returned = new Promise((resolve) => ch.onReturn = resolve)
  await ch.basicPublish("", "not-a-queue", "body", {}, true)
  const msg = await returned as AMQPMessage
  expect(msg.replyCode).toEqual(312)
  expect(msg.routingKey).toEqual("not-a-queue")
})

test('can handle nacks on confirm channel', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()

  const q = await ch.queue("", {}, {"x-overflow": "reject-publish", "x-max-length": 0})
  await ch.confirmSelect()
  await expect(q.publish("body")).rejects.toThrow("Message rejected")
})

test('throws on invalid exchange type', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const name = "test" + Math.random()
  await expect(ch.exchangeDeclare(name, "none")).rejects.toThrow(/invalid exchange type/)
})

test('can declare an exchange', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const name = "test" + Math.random()
  await ch.confirmSelect()
  await ch.exchangeDeclare(name, "fanout")
  await expect(ch.basicPublish(name, "rk", "body")).resolves.toBeDefined()
  await ch.exchangeDelete(name)
  await expect(ch.basicPublish(name, "rk", "body")).rejects.toThrow(/NOT_FOUND/)
})

test('exchange to exchange bind/unbind', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const name1 = "test1" + Math.random()
  const name2 = "test2" + Math.random()
  await ch.exchangeDeclare(name1, "fanout", { autoDelete: false })
  await ch.exchangeDeclare(name2, "fanout", { autoDelete: true })
  await ch.exchangeBind(name2, name1)
  const q = await ch.queue()
  await q.bind(name2)
  await ch.confirmSelect()
  await ch.basicPublish(name1, "", "")
  const msg1 = await ch.basicGet(q.name)
  expect(msg1?.exchange).toEqual(name1)
  await ch.exchangeUnbind(name2, name1)
  await ch.basicPublish(name1, "", "")
  const msg2 = await ch.basicGet(q.name)
  expect(msg2).toBeNull()
  await ch.exchangeDelete(name1)
})

// not implemented on servers
test.skip('can change flow state of channel', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  let flow = await ch.basicFlow(false)
  expect(flow).toEqual(false)
  flow = await ch.basicFlow(true)
  expect(flow).toEqual(true)
})

test('basic get', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  let msg
  msg = await ch.basicGet(q.name)
  expect(msg).toBeNull()
  await q.publish("foobar")
  msg = await ch.basicGet(q.name)
  expect(msg?.bodyToString()).toEqual("foobar")
})

test('transactions', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await ch.txSelect()
  await q.publish("foobar")
  const msg1 = await ch.basicGet(q.name)
  expect(msg1).toBeNull()
  await ch.txCommit()
  const msg2 = await ch.basicGet(q.name)
  expect(msg2, "missing message").toBeTruthy()
  expect(msg2?.bodyToString()).toEqual("foobar")

  await q.publish("foobar")
  await ch.txRollback()
  const msg3 = await ch.basicGet(q.name)
  expect(msg3).toBeNull()
})

test('can publish and consume msgs with large headers', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await q.publish("a".repeat(4000), { headers: { long: new Uint8Array(new TextEncoder().encode("a".repeat(4000))) } })
  await q.publish("a".repeat(8000), { headers: { long: "a".repeat(4000) } })
  await q.publish("a".repeat(8000), { headers: { long: Array(100).fill("a") } })
  const consumer = await q.subscribe({ noAck: false }, async (msg) => { if (msg.deliveryTag === 3) await msg.cancelConsumer() })
  await expect(consumer.wait()).resolves.toBeUndefined()
})

test('will throw when headers are too long', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await expect(q.publish("a".repeat(8000), { headers: { long: "a".repeat(5000) } })).rejects.toThrow()
})

test('can purge a queue', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await q.publish("a")
  const purged = await q.purge()
  expect(purged.messageCount).toEqual(1)
  const msg = await q.get()
  expect(msg).toBeNull()
})

test('can publish all type of properties', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  const headers = {
    a: 2, b: true, c: "c", d: 1.5, e: null, f: new Date(1000), g: { a: 1 },
    i: 2**32 + 1, j: 2.5**33,
  }
  const properties = {
    contentType: "application/json",
    contentEncoding: "gzip",
    headers: headers,
    deliveryMode: 2,
    priority: 1,
    correlationId: "corr",
    replyTo: "me",
    expiration: "10000",
    messageId: "msgid",
    appId: "appid",
    userId: "guest",
    type: "type",
    timestamp: new Date(Math.round(Date.now()/1000)*1000) // amqp timestamps does only have second resolution
  }
  await q.publish("", properties)
  const msg = await q.get()
  expect(msg?.properties).toMatchObject(properties)
})

test('cannot publish too long strings', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await expect(ch.queue("a".repeat(256))).rejects.toThrow(/Short string too long/)
})

test('can set prefetch', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await expect(ch.prefetch(1)).resolves.toBeUndefined()
})

test('can open a specific channel', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel(2)
  expect(ch.id).toEqual(2)
})

test('can open a specific channel twice', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel(2)
  expect(ch.id).toEqual(2)
  const ch2 = await conn.channel(2)
  expect(ch2 === ch).toEqual(true)
})

test('can publish messages spanning multiple frames', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await ch.confirmSelect()
  const q = await ch.queue("")
  const sizes = [4087, 4088, 4089, 4096, 5000, 10000]
  expect.assertions(sizes.length)
  for (let i = 0; i < sizes.length; i++) {
    const n = sizes[i]
    await q.publish(new Uint8Array(n || 0))
    const msg = await q.get()
    expect(msg?.bodySize).toEqual(n)
  }
})

test('set basic flow on channel', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await expect(ch.basicFlow(true)).resolves.toBeDefined()
})

test('confirming unknown deliveryTag', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  expect(() => ch.publishConfirmed(1, false, false)).not.toThrow()
})

// ch.deliver does enqueue a microtask, rendering the ch.deliver method untestable.
test.skip('delivering a message when no consumer exists raises', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const msg = new AMQPMessage(ch)
  msg.consumerTag = "abc"
  expect(() => ch.deliver(msg)).toThrow()
})

test("can publish null", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await expect(ch.basicPublish("amq.topic", "", null)).resolves.toBeDefined()
})

test("can publish ArrayBuffer", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await expect(ch.basicPublish("amq.topic", "", new ArrayBuffer(2))).resolves.toBeDefined()
})

test("can publish Uint8array", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await expect(ch.basicPublish("amq.topic", "", new Uint8Array(2))).resolves.toBeDefined()
})

test("can do basicRecover", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await expect(ch.basicRecover(true)).resolves.toBeUndefined()
})

test("can set frameMax", async () => {
  const amqp = getNewClient({ frameMax: 16*1024 })
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await ch.confirmSelect()
  const q = await ch.queue("")
  await q.publish("", { headers: { a: "a".repeat(15000) } })
  const msg = await q.get()
  if (msg) {
    const props = msg.properties
    if (props) {
      const headers = props.headers
      if (headers) {
        const a = headers["a"] as string
        expect(a.length).toEqual(15000)
      } else expect(headers).toBeTruthy()
    } else expect(props).toBeTruthy()
  } else expect(msg).toBeTruthy()
})

test("can't set too small frameMax", () => {
  expect(() => getNewClient({ frameMax: 16 })).toThrow()
})

test("can handle frames split over socket reads", async () => {
  const amqp = getNewClient({ frameMax: 4*1024 })
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const body = "a".repeat(5)
  const msgs = 100000
  for (let i = 0; i < msgs; i++) {
    await q.publish(body)
  }
  let i = 0
  const consumer = await q.subscribe({ noAck: true }, () => { if (++i === msgs) consumer.cancel() })
  await consumer.wait(20_000)
  expect(i).toEqual(msgs)
}, 60_000)

test("have to connect socket before opening channels", async () => {
  const amqp = getNewClient()
  await expect(amqp.channel()).rejects.toThrow(/Connection closed/)
})

test("will raise if socket is closed on send", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  await amqp.close()
  await expect(conn.channel()).rejects.toThrow()
}, 10_000)

test("can handle cancel from server", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({}, () => "")
  await q.delete()
  await expect(consumer.wait()).rejects.toThrow(/Consumer cancelled by the server/)
}, 10_000)

test("can handle heartbeats", async () => {
  const amqp = getNewClient({ heartbeat: 1 })
  const conn = await amqp.connect()
  const wait = new Promise((resolv) => setTimeout(resolv, 2000))
  await wait
  expect(conn.closed).toEqual(false)
}, 10_000)

test("has an onerror callback", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  let errMessage: string | null = null
  conn.onerror = vi.fn((err) => errMessage = err.message)
  await expect(ch.exchangeDeclare("none", "none")).rejects.toThrow()
  expect(conn.onerror).toBeCalled()
  expect(errMessage).toMatch(/invalid exchange type/)
})

test("onerror is not called when conn is closed by client", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const callbackPromise = new Promise((done, reject) => {
  conn.onerror = vi.fn(
      (err: AMQPError) => reject(new Error(`onerror should not be called when gracefully closed. Error was: ${err.message}`))
  )
    setTimeout(done, 10)
  })
  await conn.close()
  await expect(callbackPromise).resolves.toBeUndefined()
  expect(conn.onerror).not.toHaveBeenCalled()
})

test("will throw on too large headers", async () => {
  const amqp = getNewClient({ frameMax: 4096 })
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await expect(ch.basicPublish("", "x".repeat(255), null, {"headers": {a: Array(4000).fill(1)}})).rejects.toThrow(RangeError)
  await expect(ch.basicPublish("", "", null, {"headers": {a: "x".repeat(5000)}})).rejects.toThrow(RangeError)
})

test("will split body over multiple frames", async () => {
  const amqp = getNewClient({ frameMax: 4096 })
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  await ch.confirmSelect()
  await q.publish("x".repeat(5000))
  const msg = await q.get()
  if (msg)
    if (msg.body)
      expect(msg.body.length).toEqual(5000)
    else
      assert.fail("no body")
  else
  assert.fail("no msg")
})

test("can republish in consume block without race condition", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await ch.prefetch(0)
  const q = await ch.queue("")
  await ch.confirmSelect()
  await q.publish("x".repeat(500))
  const consumer = await q.subscribe({noAck: false}, async (msg) => {
    if (msg.deliveryTag < 10000) {
      await Promise.all([
        q.publish(msg.body),
        q.publish(msg.body),
        msg.ack()
      ])
    } else if (msg.deliveryTag === 10000) {
      await consumer.cancel()
    }
  })
  await expect(consumer.wait()).resolves.toBeUndefined()
  await expect(conn.close()).resolves.toBeUndefined()
  console.log(conn.bufferPool.length)
}, 20_000)

test("raises when channelMax is reached", async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  for (let i = 0; i < conn.channelMax; i++) {
    await conn.channel()
  }
  await expect(conn.channel()).rejects.toThrow('Max number of channels reached');

  // make sure other channels still work
  const ch1 = await conn.channel(1)
  await expect(ch1.basicQos(10)).resolves.toBeUndefined()
}, 20_000)

test('should fail to connect to an AMQP port', async () => {
  const amqp = new AMQPWebSocketClient("ws://127.0.0.1:5672/ws/amqp")
  await expect(amqp.connect()).rejects.toThrow()
})
