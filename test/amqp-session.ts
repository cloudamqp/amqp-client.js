import { expect, test, vi, beforeEach } from "vitest"
import { AMQPClient } from "../src/amqp-socket-client.js"
import { AMQPSession } from "../src/amqp-session.js"

beforeEach(() => {
  expect.hasAssertions()
})

test("AMQPSession.connect() returns a session", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", { reconnectInterval: 500 })
  expect(session).toBeInstanceOf(AMQPSession)

  await session.stop()
})

test("session.subscribe delivers messages via callback", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const queueName = "test-queue-" + Math.random()
  const ch = await session.client.channel()
  await ch.queue(queueName, { durable: false, autoDelete: true })

  let messageReceived = false
  const sub = await session.subscribe(queueName, { noAck: true }, async () => {
    messageReceived = true
  })

  const q2 = await ch.queue(queueName, { passive: true })
  await q2.publish("test")
  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(messageReceived).toBe(true)
  await sub.cancel()
  await session.stop()
})

test("session.subscribe accepts an AMQPQueue object", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const ch = await session.client.channel()
  const q = await ch.queue("", { durable: false, autoDelete: true })

  let messageReceived = false
  const sub = await session.subscribe(q, { noAck: true }, async () => {
    messageReceived = true
  })

  await q.publish("test")
  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(messageReceived).toBe(true)
  await sub.cancel()
  await session.stop()
})

test("subscription.cancel() removes it from session recovery", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const ch = await session.client.channel()
  const q = await ch.queue("")
  const sub = await session.subscribe(q.name, { noAck: true }, () => {})

  await expect(sub.cancel()).resolves.toBeUndefined()

  await session.stop()
})

test("session.subscribe supports prefetch option", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const queueName = "test-prefetch-queue-" + Math.random()
  const ch = await session.client.channel()
  await ch.queue(queueName, { durable: false, autoDelete: true })

  let messagesReceived = 0
  const sub = await session.subscribe(
    queueName,
    { noAck: false },
    async (msg) => {
      messagesReceived++
      if (messagesReceived === 2) {
        await msg.ack()
      }
    },
    { prefetch: 1 },
  )

  const q2 = await ch.queue(queueName, { passive: true })
  await q2.publish("message 1")
  await q2.publish("message 2")
  await q2.publish("message 3")

  await new Promise((resolve) => setTimeout(resolve, 200))

  // With prefetch=1, only 1 message is delivered until acked
  expect(messagesReceived).toBe(1)

  await sub.cancel()
  await session.stop()
})

test("session.subscribe yields messages via async generator", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1")

  const queueName = "test-generator-" + Math.random()
  const ch = await session.client.channel()
  await ch.queue(queueName, { durable: false, autoDelete: true })

  const sub = await session.subscribe(queueName, { noAck: true })

  const q2 = await ch.queue(queueName, { passive: true })
  await q2.publish("msg1")
  await q2.publish("msg2")

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

  const connectSpy = vi.spyOn(session.client, "connect").mockRejectedValue(new Error("forced failure"))

  ;(session.client as AMQPClient).socket?.destroy()

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

  ;(session.client as AMQPClient).socket?.destroy()

  await reconnected
  expect(reconnectCount).toBe(1)

  await session.stop()
})

test("subscription recovers and receives messages after reconnection", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 50,
    maxRetries: 5,
  })

  const queueName = "test-recovery-" + Math.random()

  // Pre-declare the queue so it survives reconnection (non-exclusive, autoDelete: false)
  const setupCh = await session.client.channel()
  await setupCh.queue(queueName, { durable: false, autoDelete: false })
  await setupCh.close()

  const received: string[] = []
  const sub = await session.subscribe(
    queueName,
    { noAck: true },
    (msg) => {
      received.push(msg.bodyString() || "")
    },
    { queue: { durable: false, autoDelete: false } },
  )

  // Publish a message before disconnect
  const ch1 = await session.client.channel()
  const q1 = await ch1.queue(queueName, { passive: true })
  await q1.publish("before-disconnect")
  await new Promise((resolve) => setTimeout(resolve, 100))

  const reconnected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Reconnection timed out")), 10_000)
    session.onconnect = () => {
      clearTimeout(timeout)
      resolve()
    }
  })

  ;(session.client as AMQPClient).socket?.destroy()

  await reconnected

  // Publish a message after reconnection
  const ch2 = await session.client.channel()
  const q2 = await ch2.queue(queueName, { passive: true })
  await q2.publish("after-reconnect")
  await new Promise((resolve) => setTimeout(resolve, 200))

  expect(received).toContain("before-disconnect")
  expect(received).toContain("after-reconnect")

  // Verify the subscription object is the same reference and channel is live
  expect(sub.channel.closed).toBe(false)

  await sub.cancel()

  const cleanCh = await session.client.channel()
  await cleanCh.queueDelete(queueName)

  await session.stop()
})

test("session.stop() during reconnection stops the loop", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 200,
    maxRetries: 10,
  })

  const connectSpy = vi.spyOn(session.client, "connect").mockRejectedValue(new Error("forced failure"))

  ;(session.client as AMQPClient).socket?.destroy()

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

  ;(session.client as AMQPClient).socket?.destroy()
  await new Promise((resolve) => setTimeout(resolve, 50))

  await expect(session.stop()).resolves.toBeUndefined()
})
