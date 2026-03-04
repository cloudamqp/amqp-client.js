import { expect, test, vi, beforeEach } from "vitest"
import { AMQPClient } from "../src/amqp-socket-client.js"
import { AMQPSession } from "../src/amqp-session.js"
import { AMQPQueue } from "../src/amqp-queue.js"
import { AMQPExchange } from "../src/amqp-exchange.js"
import { AMQPMessage } from "../src/amqp-message.js"
import type { AMQPBaseClient } from "../src/amqp-base-client.js"

beforeEach(() => {
  expect.hasAssertions()
})

/** Access the private client for test-only operations (socket destruction, spying). */
function testClient(session: AMQPSession): AMQPBaseClient {
  return (session as unknown as { client: AMQPBaseClient }).client
}

test("AMQPSession.connect() returns a session", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", { reconnectInterval: 500 })
  expect(session).toBeInstanceOf(AMQPSession)

  await session.stop()
})

test("session.subscribe delivers messages via callback", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const q = await session.queue("test-queue-" + Math.random(), { durable: false, autoDelete: true })

  let messageReceived = false
  const sub = await q.subscribe({ noAck: true }, async () => {
    messageReceived = true
  })

  await q.publish("test", { confirm: false })
  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(messageReceived).toBe(true)
  await sub.cancel()
  await session.stop()
})

test("session.subscribe accepts a broker-named queue", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const q = await session.queue("", { durable: false, autoDelete: true })

  let messageReceived = false
  const sub = await q.subscribe({ noAck: true }, async () => {
    messageReceived = true
  })

  await q.publish("test", { confirm: false })
  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(messageReceived).toBe(true)
  await sub.cancel()
  await session.stop()
})

test("subscription.cancel() removes it from session recovery", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const q = await session.queue("test-cancel-" + Math.random(), { durable: false, autoDelete: true })
  const sub = await q.subscribe({ noAck: true }, () => {})

  await expect(sub.cancel()).resolves.toBeUndefined()

  await session.stop()
})

test("session.subscribe supports prefetch option", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const q = await session.queue("test-prefetch-queue-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("message 1", { confirm: false })
  await q.publish("message 2", { confirm: false })
  await q.publish("message 3", { confirm: false })

  const received: string[] = []
  const sub = await q.subscribe({ prefetch: 1 }, async (msg) => {
    received.push(msg.bodyString() ?? "")
  })

  await new Promise((resolve) => setTimeout(resolve, 200))

  expect(received).toEqual(["message 1", "message 2", "message 3"])

  await sub.cancel()
  await session.stop()
})

test("session.subscribe yields messages via async generator", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const q = await session.queue("test-generator-" + Math.random(), { durable: false, autoDelete: true })

  const sub = await q.subscribe({ noAck: true })

  await q.publish("msg1", { confirm: false })
  await q.publish("msg2", { confirm: false })

  const received: string[] = []
  for await (const msg of sub) {
    received.push(msg.bodyString()!)
    if (received.length >= 2) break
  }

  expect(received).toEqual(["msg1", "msg2"])
  await sub.cancel()
  await session.stop()
})

test("session.onfailed fires when maxRetries exhausted", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 50,
    maxRetries: 2,
  })

  const onfailed = vi.fn()
  session.onfailed = onfailed

  const client = testClient(session)
  const connectSpy = vi.spyOn(client, "connect").mockRejectedValue(new Error("forced failure"))

  ;(client as AMQPClient).socket?.destroy()

  // Wait long enough for 2 retries + backoff (50ms + 100ms) with buffer
  await new Promise((resolve) => setTimeout(resolve, 500))

  expect(onfailed).toHaveBeenCalledTimes(1)
  expect(onfailed.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  expect(connectSpy).toHaveBeenCalledTimes(2)

  connectSpy.mockRestore()
  await session.stop()
})

test("session.onconnect fires after successful reconnection", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 50,
    maxRetries: 5,
  })

  let reconnectCount = 0
  const reconnected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("onconnect did not fire within 5s")), 5_000)
    session.onconnect = () => {
      clearTimeout(timeout)
      reconnectCount++
      resolve()
    }
  })

  ;(testClient(session) as AMQPClient).socket?.destroy()

  await reconnected
  expect(reconnectCount).toBe(1)

  await session.stop()
})

test("subscription recovers and receives messages after reconnection", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 50,
    maxRetries: 5,
  })

  const q = await session.queue("test-recovery-" + Math.random(), { durable: false, autoDelete: false })

  const received: string[] = []
  const sub = await q.subscribe({ noAck: true }, (msg) => {
    received.push(msg.bodyString() || "")
  })

  // Publish a message before disconnect
  await q.publish("before-disconnect", { confirm: false })
  await new Promise((resolve) => setTimeout(resolve, 100))

  const reconnected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Reconnection timed out")), 10_000)
    session.onconnect = () => {
      clearTimeout(timeout)
      resolve()
    }
  })

  ;(testClient(session) as AMQPClient).socket?.destroy()

  await reconnected

  // Publish a message after reconnection
  await q.publish("after-reconnect", { confirm: false })
  await new Promise((resolve) => setTimeout(resolve, 200))

  expect(received).toContain("before-disconnect")
  expect(received).toContain("after-reconnect")

  // Verify the subscription object is the same reference and channel is live
  expect(sub.channel.closed).toBe(false)

  await sub.cancel()
  await q.delete()
  await session.stop()
})

test("session.stop() during reconnection stops the loop", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 200,
    maxRetries: 10,
  })

  const client = testClient(session)
  const connectSpy = vi.spyOn(client, "connect").mockRejectedValue(new Error("forced failure"))

  ;(client as AMQPClient).socket?.destroy()

  // Stop before the first reconnection attempt fires
  await new Promise((resolve) => setTimeout(resolve, 50))
  await session.stop()

  // Confirm no further reconnection attempts
  await new Promise((resolve) => setTimeout(resolve, 500))

  expect(connectSpy.mock.calls.length).toBeLessThanOrEqual(1)
  connectSpy.mockRestore()
})

test("session.stop() when already disconnected does not throw", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", { maxRetries: 1 })

  ;(testClient(session) as AMQPClient).socket?.destroy()
  await new Promise((resolve) => setTimeout(resolve, 50))

  await expect(session.stop()).resolves.toBeUndefined()
})

test("session.queue() declares a queue and returns AMQPQueue", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const q = await session.queue("test-sq-" + Math.random(), { durable: false, autoDelete: true })
  expect(q).toBeInstanceOf(AMQPQueue)
  expect(q.name).toMatch(/^test-sq-/)

  await session.stop()
})

test("AMQPQueue (session-backed).publish() and get() round-trip", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const q = await session.queue("test-sq-rtt-" + Math.random(), { durable: false, autoDelete: true })
  await q.publish("round-trip")

  const msg = await q.get({ noAck: true })
  expect(msg?.bodyString()).toBe("round-trip")

  await session.stop()
})

test("AMQPQueue (session-backed).subscribe() recovers after reconnect", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 50,
    maxRetries: 5,
  })
  const qName = "test-sq-recovery-" + Math.random()

  const q = await session.queue(qName, { durable: false, autoDelete: false })

  const received: string[] = []
  const sub = await q.subscribe({ noAck: true }, (msg) => {
    received.push(msg.bodyString() ?? "")
  })

  await q.publish("before-disconnect")
  await new Promise((resolve) => setTimeout(resolve, 100))

  const reconnected = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("reconnect timed out")), 10_000)
    session.onconnect = () => {
      clearTimeout(t)
      resolve()
    }
  })
  ;(testClient(session) as AMQPClient).socket?.destroy()
  await reconnected

  await q.publish("after-reconnect")
  await new Promise((resolve) => setTimeout(resolve, 200))

  expect(received).toContain("before-disconnect")
  expect(received).toContain("after-reconnect")

  await sub.cancel()
  await q.delete()
  await session.stop()
})

test("session.exchange() declares an exchange and returns AMQPExchange", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const xName = "test-exchange-" + Math.random()

  const x = await session.exchange(xName, "direct", { durable: false, autoDelete: true })
  expect(x).toBeInstanceOf(AMQPExchange)
  expect(x.name).toBe(xName)

  await x.delete()
  await session.stop()
})

test("session.fanoutExchange() publishes to all bound queues", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const xName = "test-fanout-" + Math.random()
  const qName = "test-fanout-q-" + Math.random()

  const x = await session.fanoutExchange(xName, { durable: false, autoDelete: true })
  const q = await session.queue(qName, { durable: false, autoDelete: true })
  await q.bind(xName, "")

  await x.publish("fanout msg")
  await new Promise((resolve) => setTimeout(resolve, 100))

  const msg = await q.get({ noAck: true })
  expect(msg?.bodyString()).toBe("fanout msg")

  await session.stop()
})

test("session.topicExchange() routes by pattern", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const xName = "test-topic-" + Math.random()
  const qName = "test-topic-q-" + Math.random()

  const x = await session.topicExchange(xName, { durable: false, autoDelete: true })
  const q = await session.queue(qName, { durable: false, autoDelete: true })
  await q.bind(xName, "events.#")

  await x.publish("topic msg", { routingKey: "events.user.created" })
  await new Promise((resolve) => setTimeout(resolve, 100))

  const msg = await q.get({ noAck: true })
  expect(msg?.bodyString()).toBe("topic msg")

  await session.stop()
})

test("session.directExchange('') returns the default exchange handle", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const qName = "test-default-x-" + Math.random()

  const x = await session.directExchange("")
  expect(x.name).toBe("")

  const q = await session.queue(qName, { durable: false, autoDelete: true })

  await x.publish("via default exchange", { routingKey: qName })
  await new Promise((resolve) => setTimeout(resolve, 100))

  const msg = await q.get({ noAck: true })
  expect(msg?.bodyString()).toBe("via default exchange")

  await session.stop()
})

test("AMQPExchange.bind() and unbind() work", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const srcName = "test-xe-src-" + Math.random()
  const dstName = "test-xe-dst-" + Math.random()

  const src = await session.fanoutExchange(srcName, { durable: false, autoDelete: true })
  const dst = await session.fanoutExchange(dstName, { durable: false, autoDelete: true })

  await expect(dst.bind(src)).resolves.toBeInstanceOf(AMQPExchange)
  await expect(dst.unbind(src)).resolves.toBeInstanceOf(AMQPExchange)

  await session.stop()
})

test("AMQPExchange.delete() removes the exchange", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const xName = "test-del-x-" + Math.random()

  const x = await session.exchange(xName, "direct", { durable: false, autoDelete: false })
  await expect(x.delete()).resolves.toBeUndefined()

  await session.stop()
})

test("AMQPQueue.subscribe() delivers messages via callback", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-q-sub-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("hello queue")
  const received = await new Promise<string>((resolve) => {
    q.subscribe({ noAck: true }, (msg) => resolve(msg.bodyString()!))
  })

  expect(received).toBe("hello queue")
  await session.stop()
})

test("AMQPQueue.subscribe() nack", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-q-nack-" + Math.random(), { durable: false, autoDelete: true })

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
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-q-gen-" + Math.random(), { durable: false, autoDelete: true })

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
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-q-paf-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("fire and forget", { confirm: false })
  await new Promise((resolve) => setTimeout(resolve, 50))

  const msg = await q.get({ noAck: true })
  expect(msg?.bodyString()).toBe("fire and forget")
  await session.stop()
})

test("AMQPQueue.bind() and unbind()", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-q-bind-" + Math.random(), { durable: false, autoDelete: true })

  await expect(q.bind("amq.topic", "test.key")).resolves.toBeInstanceOf(AMQPQueue)
  await expect(q.unbind("amq.topic", "test.key")).resolves.toBeInstanceOf(AMQPQueue)

  await session.stop()
})

test("AMQPQueue.purge() empties the queue", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-q-purge-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("msg1", { confirm: false })
  await q.publish("msg2", { confirm: false })
  await new Promise((resolve) => setTimeout(resolve, 50))

  const result = await q.purge()
  expect(result.messageCount).toBe(2)
  await session.stop()
})

test("AMQPQueue.delete() removes the queue", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-q-del-" + Math.random(), { durable: false, autoDelete: false })

  await expect(q.delete()).resolves.toBeDefined()
  await session.stop()
})

test("AMQPQueue.subscribe() acks message after callback returns", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-autoack-default-" + Math.random(), { durable: false, autoDelete: true })
  await q.publish("hello")

  const ackSpy = vi.spyOn(AMQPMessage.prototype, "ack")

  const received: string[] = []
  const sub = await q.subscribe(async (msg) => {
    received.push(msg.bodyString() ?? "")
  })

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(received).toEqual(["hello"])
  expect(ackSpy).toHaveBeenCalledOnce()

  ackSpy.mockRestore()
  await sub.cancel()
  await session.stop()
})

test("AMQPQueue.subscribe() acks message after successful callback with prefetch", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-autoack-" + Math.random(), { durable: false, autoDelete: true })
  await q.publish("hello")

  const ackSpy = vi.spyOn(AMQPMessage.prototype, "ack")

  const received: string[] = []
  const sub = await q.subscribe({ prefetch: 1 }, async (msg) => {
    received.push(msg.bodyString() ?? "")
  })

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(received).toEqual(["hello"])
  expect(ackSpy).toHaveBeenCalledOnce()

  ackSpy.mockRestore()
  await sub.cancel()
  await session.stop()
})

test("AMQPQueue.subscribe() nacks message when callback throws", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-autoack-nack-" + Math.random(), { durable: false, autoDelete: true })
  await q.publish("fail")

  const nackSpy = vi.spyOn(AMQPMessage.prototype, "nack")

  let callCount = 0
  const sub = await q.subscribe({ requeueOnNack: false, prefetch: 1 }, async () => {
    callCount++
    throw new Error("boom")
  })

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(callCount).toBe(1)
  expect(nackSpy).toHaveBeenCalledWith(false)

  nackSpy.mockRestore()
  await sub.cancel()
  await session.stop()
})

test("AMQPQueue.subscribe() does not ack when noAck is true", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-autoack-noack-" + Math.random(), { durable: false, autoDelete: true })
  await q.publish("hi")

  const ackSpy = vi.spyOn(AMQPMessage.prototype, "ack")

  const received: string[] = []

  const sub = await q.subscribe({ noAck: true, prefetch: 1 }, async (msg) => {
    received.push(msg.bodyString() ?? "")
  })

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(received).toEqual(["hi"])
  expect(ackSpy).not.toHaveBeenCalled()

  ackSpy.mockRestore()
  await sub.cancel()
  await session.stop()
})

test("AMQPQueue.subscribe() async iterator auto-acks on advance", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-iter-autoack-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("msg1")
  await q.publish("msg2")

  const msgs: AMQPMessage[] = []
  const sub = await q.subscribe()
  for await (const msg of sub) {
    msgs.push(msg)
    if (msgs.length >= 2) break
  }

  // msg1 was auto-acked when the loop advanced to msg2; msg2 was not (loop broke)
  expect(msgs[0]!.isAcked).toBe(true)
  expect(msgs[1]!.isAcked).toBe(false)

  await sub.cancel()
  await session.stop()
})

test("AMQPQueue.subscribe() async iterator does not ack when noAck is true", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-iter-noack-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("msg1")
  await q.publish("msg2")

  const msgs: AMQPMessage[] = []
  const sub = await q.subscribe({ noAck: true })
  for await (const msg of sub) {
    msgs.push(msg)
    if (msgs.length >= 2) break
  }

  expect(msgs[0]!.isAcked).toBe(false)
  expect(msgs[1]!.isAcked).toBe(false)

  await sub.cancel()
  await session.stop()
})

test("AMQPQueue.subscribe() async iterator does not double-ack if message already acked", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-iter-double-ack-" + Math.random(), { durable: false, autoDelete: true })

  await q.publish("msg1")
  await q.publish("msg2")

  const { AMQPChannel } = await import("../src/amqp-channel.js")
  const basicAckSpy = vi.spyOn(AMQPChannel.prototype, "basicAck")

  const sub = await q.subscribe()
  for await (const msg of sub) {
    await msg.ack() // manual ack inside the loop
    if (basicAckSpy.mock.calls.length >= 1) break
  }

  // Only one wire call despite auto-ack also running
  expect(basicAckSpy).toHaveBeenCalledOnce()

  basicAckSpy.mockRestore()
  await sub.cancel()
  await session.stop()
})

test("AMQPQueue.subscribe() does not double-ack if callback already acked", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")
  const q = await session.queue("test-no-double-ack-" + Math.random(), { durable: false, autoDelete: true })
  await q.publish("hello")

  const { AMQPChannel } = await import("../src/amqp-channel.js")
  const basicAckSpy = vi.spyOn(AMQPChannel.prototype, "basicAck")

  const sub = await q.subscribe(async (msg) => {
    await msg.ack()
  })

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(basicAckSpy).toHaveBeenCalledOnce()

  basicAckSpy.mockRestore()
  await sub.cancel()
  await session.stop()
})
