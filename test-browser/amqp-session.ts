/// <reference types="vite/client" />
import { expect, test, beforeEach } from "vitest"
import { AMQPSession } from "../src/amqp-session.js"
import { AMQPQueue } from "../src/amqp-queue.js"
import { AMQPExchange } from "../src/amqp-exchange.js"
import { AMQPMessage } from "../src/amqp-message.js"

const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:15670/ws/amqp"

beforeEach(() => {
  expect.hasAssertions()
})

test("AMQPSession.connect() returns a session over WebSocket", async () => {
  const session = await AMQPSession.connect(WS_URL)
  expect(session).toBeInstanceOf(AMQPSession)
  await session.stop()
})

test("session.queue() declares a queue and returns AMQPQueue", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-sq-" + Math.random(), { durable: false, autoDelete: true })
  expect(q).toBeInstanceOf(AMQPQueue)
  expect(q.name).toMatch(/^test-ws-sq-/)
  await session.stop()
})

test("AMQPQueue.publish() and get() round-trip", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-rtt-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("round-trip")
  const msg = await q.get({ noAck: true })
  expect(msg?.bodyString()).toBe("round-trip")

  await session.stop()
})

test("AMQPQueue.subscribe() delivers messages via callback", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-sub-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("hello ws queue")
  const received = await new Promise<string>((resolve) => {
    q.subscribe({ noAck: true }, (msg) => resolve(msg.bodyString()!))
  })

  expect(received).toBe("hello ws queue")
  await session.stop()
})

test("AMQPQueue.subscribe() nack", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-nack-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("nack me")
  const msg = await new Promise<AMQPMessage>((resolve) => {
    q.subscribe({ noAck: false }, (m) => {
      m.nack()
      resolve(m)
    })
  })

  expect(msg.bodyString()).toBe("nack me")
  await session.stop()
})

test("AMQPQueue.subscribe() async generator", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-gen-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("msg1")
  await q.publish("msg2")

  const received: string[] = []
  const sub = await q.subscribe({ noAck: true })
  for await (const msg of sub) {
    received.push(msg.bodyString()!)
    if (received.length >= 2) break
  }

  expect(received).toEqual(["msg1", "msg2"])
  await session.stop()
})

test("AMQPQueue.publish({ confirm: false }) sends without waiting for confirm", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-paf-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("fire and forget", { confirm: false })
  await new Promise((resolve) => setTimeout(resolve, 50))

  const msg = await q.get({ noAck: true })
  expect(msg?.bodyString()).toBe("fire and forget")
  await session.stop()
})

test("AMQPQueue.bind() and unbind()", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-bind-" + Math.random(), { durable: false, autoDelete: true })

  await expect(q.bind("amq.topic", "test.key")).resolves.toBeInstanceOf(AMQPQueue)
  await expect(q.unbind("amq.topic", "test.key")).resolves.toBeInstanceOf(AMQPQueue)

  await session.stop()
})

test("AMQPQueue.purge() empties the queue", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-purge-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("msg1", { confirm: false })
  await q.publish("msg2", { confirm: false })
  await new Promise((resolve) => setTimeout(resolve, 50))

  const result = await q.purge()
  expect(result.messageCount).toBe(2)
  await session.stop()
})

test("AMQPQueue.delete() removes the queue", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-del-" + Math.random(), { durable: false, autoDelete: false })

  await expect(q.delete()).resolves.toBeDefined()
  await session.stop()
})

test("AMQPQueue.subscribe() with unconfirmed publish round-trip", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-sessub-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("via subscribe", { confirm: false })
  const received = await new Promise<string>((resolve) => {
    void q.subscribe({ noAck: true }, (msg) => resolve(msg.bodyString()!))
  })

  expect(received).toBe("via subscribe")
  await session.stop()
})

test("AMQPQueue.publish() and get() confirmed round-trip", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const q = await session.queue("test-ws-spub-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("confirmed")
  const msg = await q.get({ noAck: true })
  expect(msg?.bodyString()).toBe("confirmed")

  await session.stop()
})

test("session.exchange() and AMQPExchange.publish() route messages", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const xName = "test-ws-x-" + Math.random()
  const q = await session.queue("test-ws-xq-" + Math.random(), { durable: false, autoDelete: true })

  const x = await session.fanoutExchange(xName, { durable: false, autoDelete: true })
  expect(x).toBeInstanceOf(AMQPExchange)
  await q.bind(xName)

  await x.publish("via exchange")
  await new Promise((resolve) => setTimeout(resolve, 100))

  const msg = await q.get({ noAck: true })
  expect(msg?.bodyString()).toBe("via exchange")

  await session.stop()
})

test("session.rpcClient() and session.rpcServer() round-trip", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const qName = "test-ws-rpc-" + Math.random()

  await session.rpcServer(qName, (_body, msg) => {
    return `reply:${msg.bodyString()}`
  })

  const rpc = await session.rpcClient()
  const reply = await rpc.call(qName, "hello")
  expect(reply.bodyString()).toEqual("reply:hello")

  await session.stop()
})

test("session.rpcCall() one-shot round-trip", async () => {
  const session = await AMQPSession.connect(WS_URL)
  const qName = "test-ws-rpc-oneshot-" + Math.random()

  await session.rpcServer(qName, (_body, msg) => {
    return `got:${msg.bodyString()}`
  })

  const reply = await session.rpcCall(qName, "ping")
  expect(reply.bodyString()).toEqual("got:ping")

  await session.stop()
})
