import test from 'ava';
import AMQPClient from '../src/amqp-socket-client.js';
import AMQPMessage from '../src/amqp-message.js';

test('can parse the url correctly', t => {
  const username = 'user_name'
  const password = 'passwd'
  const hostname = '127.0.0.1'
  const port = 5672
  const vhost = 'my_host'
  const name = 'test'
  const client = new AMQPClient(`amqp://${username}:${password}@${hostname}:${port}/${vhost}?name=${name}`);
  t.is(client.username, username);
  t.is(client.password, password);
  t.is(client.host, hostname);
  t.is(client.port, port);
  t.is(client.vhost, vhost);
  t.is(client.name, name);
})

test('can open a connection and a channel', t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  return amqp.connect()
    .then((conn) => conn.channel())
    .then((ch) => t.is(ch.connection.channels.length, 2)) // 2 because channel 0 is counted
})

test('can publish and consume', t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
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
  }).then((result: AMQPMessage) => t.is(result.bodyString(), "hello world"))
})

test('can nack a message', t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
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
  }).then((result: AMQPMessage) => t.is(result.bodyString(), "hello world"))
})

test('can reject a message', t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
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
  }).then((result: AMQPMessage) => t.is(result.bodyString(), "hello world"))
})

test('can unbind a queue from exchange', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  await q.bind("amq.topic", "asd")
  await t.notThrowsAsync(async () =>  await q.unbind("amq.topic", "asd"))
})

test('can unsubscribe from a queue', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({}, () => "")
  await t.notThrowsAsync(async () =>  await q.unsubscribe(consumer.tag))
})

test("can delete a queue", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  await t.notThrowsAsync(async () =>  await q.delete())
})

test("can get message from a queue", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  await q.publish("message")
  const msg = await q.get({noAck: true})
  t.is((msg as AMQPMessage).bodyString(), "message")
})

test('will throw an error', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await t.throwsAsync(async () => { await ch.queue("amq.foobar") },
                      { message: /ACCESS_REFUSED/ })
})

test('will throw an error after consumer timeout', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({noAck: false}, () => "")
  await t.throwsAsync(async () => { await consumer.wait(1) })
})

test('will throw an error if consumer is closed', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({noAck: false}, () => "")
  consumer.setClosed(new Error("testing"))
  try {
    await consumer.wait(1);
  } catch (error) {
    t.is((error as Error).message, "testing")
  }
})

test('can cancel a consumer', t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  return amqp.connect()
    .then((conn) => conn.channel())
    .then((ch) => ch.queue(""))
    .then((q) => q.subscribe({noAck: false}, console.log))
    .then((consumer) => consumer.cancel())
    .then((channel) => t.is(channel.consumers.size, 0))
})

test('will clear consumer wait timeout on cancel', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({noAck: false}, () => "")
  const wait = consumer.wait(1000);
  consumer.cancel()
  const ok = await wait
  t.is(ok, undefined)
})

test('can close a channel', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await ch.close()
  const error = await t.throwsAsync(ch.close())
  t.is(error.message, 'Channel is closed');
})

test('connection error raises everywhere', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await conn.close()
  await t.throwsAsync(async () => { await ch.close() },
                      { message: /Channel is closed/ })
})

test('consumer stops wait on cancel', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  const consumer = await q.subscribe({}, () => ({}))
  await q.publish("foobar")
  await consumer.cancel()
  const ok = await consumer.wait()
  t.is(ok, undefined)
})

test('consumer stops wait on channel error', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  const consumer = await q.subscribe({}, () => ({}))
  // acking invalid delivery tag should close channel
  setTimeout(() => ch.basicAck(99999), 1)
  await t.throwsAsync(consumer.wait())
})

test('connection error raises on publish', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await conn.close()
  await t.throwsAsync(q.publish("foobar"))
})

test('wait for publish confirms', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  let tag

  // publishes without confirm should return 0
  tag = await ch.basicPublish("amq.fanout", "rk", "body")
  t.is(tag, 0)
  tag = await ch.basicPublish("amq.fanout", "rk", "body")
  t.is(tag, 0)

  // publishes with confirm should return the delivery tag id
  await ch.confirmSelect()
  tag = await ch.basicPublish("amq.fanout", "rk", "body")
  t.is(tag, 1)
  tag = await ch.basicPublish("amq.fanout", "rk", "body")
  t.is(tag, 2)

  // can wait for multiple tags
  const tags = await Promise.all([
    ch.basicPublish("amq.fanout", "rk", "body"),
    ch.basicPublish("amq.fanout", "rk", "body")
  ])
  t.deepEqual(tags, [3,4])
})

test('can handle rejects', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()

  const returned = new Promise((resolve) => ch.onReturn = resolve)
  await ch.basicPublish("", "not-a-queue", "body", {}, true)
  const msg = await returned as AMQPMessage
  t.is(msg.replyCode, 312)
  t.is(msg.routingKey, "not-a-queue")
})

test('can handle nacks on confirm channel', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()

  const q = await ch.queue("", {}, {"x-overflow": "reject-publish", "x-max-length": 0})
  await ch.confirmSelect()
  const error = await t.throwsAsync(q.publish("body"))
  t.is(error.message, "Message rejected")
})

test('throws on invalid exchange type', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const name = "test" + Math.random()
  const err = await t.throwsAsync(ch.exchangeDeclare(name, "none"))
  t.regex(err.message, /invalid exchange type/)
})

test('can declare an exchange', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const name = "test" + Math.random()
  await ch.confirmSelect()
  await ch.exchangeDeclare(name, "fanout")
  await t.notThrowsAsync(ch.basicPublish(name, "rk", "body"))
  await ch.exchangeDelete(name)
  const err = await t.throwsAsync(ch.basicPublish(name, "rk", "body"))
  t.regex(err.message, /NOT_FOUND/)
})

test('exchange to exchange bind/unbind', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
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
  t.assert(msg1)
  if (msg1)
    t.is(msg1.exchange, name1)
  await ch.exchangeUnbind(name2, name1)
  await ch.basicPublish(name1, "", "")
  const msg2 = await ch.basicGet(q.name)
  t.is(msg2, null)
  await ch.exchangeDelete(name1)
})

test.skip('can change flow state of channel', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  let flow = await ch.basicFlow(false)
  t.is(flow, false)
  flow = await ch.basicFlow(true)
  t.is(flow, true)
})

test('basic get', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  let msg
  msg = await ch.basicGet(q.name)
  t.is(msg, null)
  await q.publish("foobar")
  msg = await ch.basicGet(q.name)
  t.assert(msg)
  if (msg)
    t.is(msg.bodyToString(), "foobar")
})

test('transactions', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await ch.txSelect()
  await q.publish("foobar")
  const msg1 = await ch.basicGet(q.name)
  t.is(msg1, null)
  await ch.txCommit()
  const msg2 = await ch.basicGet(q.name)
  t.assert(msg2, "missing message")
  if (msg2)
    t.is(msg2.bodyToString(), "foobar")

  await q.publish("foobar")
  await ch.txRollback()
  const msg3 = await ch.basicGet(q.name)
  t.is(msg3, null)
})

test('can publish and consume msgs with large headers', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await q.publish("a".repeat(4000), { headers: { long: Buffer.from("a".repeat(4000)) } })
  await q.publish("a".repeat(8000), { headers: { long: "a".repeat(4000) } })
  await q.publish("a".repeat(8000), { headers: { long: Array(100).fill("a") } })
  const consumer = await q.subscribe({ noAck: false }, async (msg) => { if (msg.deliveryTag === 3) await msg.cancelConsumer() })
  const ok = await consumer.wait()
  t.is(ok, undefined)
})

test.skip('will throw when headers are too long', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await t.throwsAsync(async () => await q.publish("a".repeat(8000), { headers: { long: "a".repeat(5000) } }))
})

test('can purge a queue', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await q.publish("a")
  const purged = await q.purge()
  t.is(purged.messageCount, 1)
  const msg = await q.get()
  t.is(msg, null)
})

test('can publish all type of properties', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
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
  if (msg)
    t.deepEqual(msg.properties, properties)
  else
    t.assert(msg)
})

test('cannot publish too long strings', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await t.throwsAsync(async () => await ch.queue("a".repeat(256)),
                      { message: /Short string too long/ })
})

test('can set prefetch', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const ok = await ch.prefetch(1)
  t.is(ok, undefined)
})

test('can open a specific channel', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel(2)
  t.is(ch.id, 2)
})

test('can open a specific channel twice', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel(2)
  t.is(ch.id, 2)
  const ch2 = await conn.channel(2)
  t.is(ch2, ch)
})

test('can publish messages spanning multiple frames', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await ch.confirmSelect()
  const q = await ch.queue("")
  const sizes = [4087, 4088, 4089, 4096, 5000, 10000]
  t.plan(sizes.length)
  for (let i = 0; i < sizes.length; i++) {
    const n = sizes[i]
    await q.publish(Buffer.alloc(n || 0))
    const msg = await q.get()
    if (msg) t.is(msg.bodySize, n)
  }
})

test('set basic flow on channel', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await t.notThrowsAsync(async () =>  await ch.basicFlow(true))
})

test('can resolve promise on channel', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  t.false(ch.resolvePromise())
})

test('confirming unknown deliveryTag', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  t.notThrows(() => ch.publishConfirmed(1, false, false))
})

// ch.deliver does enqueue a microtask, rendering the ch.deliver method untestable.
test.skip('delivering a message when no consumer exists raises', async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const msg = new AMQPMessage(ch)
  msg.consumerTag = "abc"
  t.throws(() => ch.deliver(msg))
})

test("can publish null", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  t.notThrows(() => ch.basicPublish("amq.topic", "", null))
})

test("can publish ArrayBuffer", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  t.notThrows(() => ch.basicPublish("amq.topic", "", new ArrayBuffer(2)))
})

test("can publish Uint8array", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  t.notThrows(() => ch.basicPublish("amq.topic", "", new Uint8Array(2)))
})

test("can do basicRecover", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  t.notThrows(() => ch.basicRecover(true))
})

test("can set frameMax", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1?frameMax=" + 16*1024)
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
        t.is(a.length, 15000)
      } else t.assert(headers)
    } else t.assert(props)
  } else t.assert(msg)
})

test("can't set too small frameMax", t => {
  t.throws(() => new AMQPClient("amqp://127.0.0.1?frameMax=" + 16))
})

test("can handle frames split over socket reads", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1?frameMax=" + 4*1024)
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
  await consumer.wait(5000)
  t.is(i, msgs)
})

test("have to connect socket before opening channels", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  await t.throwsAsync(() => amqp.channel(), { message: /not connected/ })
})

test("will raise if socket is closed on send", async t => {
  const amqp = new AMQPClient("amqp://127.0.0.1")
  const conn = await amqp.connect()
  if (amqp.socket) amqp.socket.destroy()
  await t.throwsAsync(() => conn.channel())
})
