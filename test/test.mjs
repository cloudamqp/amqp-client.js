import test from 'ava';
import AMQPClient from '../src/amqp-socket-client.mjs';

test('can open a connection and a channel', t => {
  const amqp = new AMQPClient("amqp://")
  return amqp.connect()
    .then((conn) => conn.channel())
    .then((ch) => t.is(ch.connection.channels.length, 2)) // 2 because channel 0 is counted
})

test('can publish and consume', t => {
  const amqp = new AMQPClient("amqp://localhost")
  return new Promise((resolve, reject) => {
    amqp.connect()
      .then((conn) => conn.channel())
      .then((ch) => ch.queue(""))
      .then((q) => q.publish("hello world"))
      .then((q) => q.subscribe({noAck: false}, (msg) => {
        msg.ack()
        resolve(msg)
      }))
      .catch(reject)
  }).then((result) => t.is(result.bodyString(), "hello world"))
})

test('will throw an error', t => {
  const amqp = new AMQPClient("amqp://localhost")
  return amqp.connect()
    .then((conn) => conn.channel())
    .then((ch) => ch.queue("amq.foobar"))
    .catch((e) => t.regex(e.message, /ACCESS_REFUSED/))
})

test('can cancel a consumer', t => {
  const amqp = new AMQPClient("amqp://localhost")
  return amqp.connect()
    .then((conn) => conn.channel())
    .then((ch) => ch.queue(""))
    .then((q) => q.subscribe({noAck: false}, console.log))
    .then((consumer) => consumer.cancel())
    .then((channel) => t.deepEqual(channel.consumers, {}))
})

test('can close a channel', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await ch.close()
  const error = await t.throwsAsync(ch.close())
  t.is(error.message, 'Channel is closed');
})

test('connection error raises everywhere', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  await conn.close()
  try {
    await ch.close()
  } catch (err) {
    t.is(err.message, 'Channel is closed');
  }
})

test('consumer stops wait on cancel', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  const consumer = await q.subscribe({}, () => { })
  await q.publish("foobar")
  await consumer.cancel()
  const ok = await consumer.wait()
  t.is(ok, undefined)
})

test('consumer stops wait on channel error', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  const consumer = await q.subscribe({}, () => { })
  // acking invalid delivery tag should close channel
  setTimeout(() => ch.basicAck(99999), 1)
  await t.throwsAsync(consumer.wait())
})

test('connection error raises on publish', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await conn.close()
  await t.throwsAsync(q.publish("foobar"))
})

test('wait for publish confirms', async t => {
  const amqp = new AMQPClient("amqp://localhost")
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
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()

  const returned = new Promise((resolve) => ch.onReturn = resolve)
  await ch.basicPublish("", "not-a-queue", "body", {}, true)
  const msg = await returned
  t.is(msg.replyCode, 312)
  t.is(msg.routingKey, "not-a-queue")
})

test('can handle nacks on confirm channel', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()

  const q = await ch.queue("", {}, {"x-overflow": "reject-publish", "x-max-length": 0})
  await ch.confirmSelect()
  const error = await t.throwsAsync(q.publish("body"))
  t.is(error.message, "Message rejected")
})

test('throws on invalid exchange type', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  let ch = await conn.channel()
  const name = "test" + Math.random()
  let err = await t.throwsAsync(ch.exchangeDeclare(name, "none"))
  t.regex(err.message, /invalid exchange type/)
})

test('can declare an exchange', async t => {
  const amqp = new AMQPClient("amqp://localhost")
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
  const amqp = new AMQPClient("amqp://localhost")
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
  await ch.basicPublish(name1)
  const msg1 = await ch.basicGet(q.name)
  t.is(msg1.exchange, name1)
  await ch.exchangeUnbind(name2, name1)
  await ch.basicPublish(name1)
  const msg2 = await ch.basicGet(q.name)
  t.is(msg2, null)
  await ch.exchangeDelete(name1, "fanout")
})

test.skip('can change flow state of channel', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  let flow = await ch.basicFlow(false)
  t.is(flow, false)
  flow = await ch.basicFlow(true)
  t.is(flow, true)
})

test('basic get', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  let msg
  msg = await ch.basicGet(q.name)
  t.is(msg, null)
  await q.publish("foobar")
  msg = await ch.basicGet(q.name)
  t.is(msg.bodyToString(), "foobar")
})

test('transactions', async t => {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  const ch = await conn.channel()
  const q = await ch.queue()
  await ch.txSelect()
  await q.publish("foobar")
  const msg1 = await ch.basicGet(q.name)
  t.is(msg1, null)
  await ch.txCommit()
  const msg2 = await ch.basicGet(q.name)
  t.is(msg2.bodyToString(), "foobar")

  await q.publish("foobar")
  await ch.txRollback()
  const msg3 = await ch.basicGet(q.name)
  t.is(msg3, null)
})
