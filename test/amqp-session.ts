import { expect, test, vi, beforeEach } from "vitest"
import { AMQPClient } from "../src/amqp-socket-client.js"
import { AMQPSession } from "../src/amqp-session.js"
import { AMQPQueue } from "../src/amqp-queue.js"
import { AMQPExchange } from "../src/amqp-exchange.js"
import { AMQPMessage } from "../src/amqp-message.js"
import { AMQPCodecRegistry } from "../src/amqp-codec-registry.js"
import type { AMQPBaseClient } from "../src/amqp-base-client.js"
import type { CodecMode } from "../src/amqp-message.js"

beforeEach(() => {
  expect.hasAssertions()
})

/** Access the private client for test-only operations (socket destruction, spying). */
function testClient(session: AMQPSession<CodecMode>): AMQPBaseClient {
  return (session as unknown as { client: AMQPBaseClient }).client
}

async function withSession(
  fn: (session: AMQPSession<"plain">) => Promise<void>,
  options?: Parameters<typeof AMQPSession.connect>[1],
): Promise<void> {
  const session = await AMQPSession.connect("amqp://127.0.0.1", options)
  try {
    await fn(session)
  } finally {
    await session.stop()
  }
}

test("AMQPSession.connect() returns a session", () =>
  withSession(
    async (session) => {
      expect(session).toBeInstanceOf(AMQPSession)
    },
    { reconnectInterval: 500 },
  ))

test("session.subscribe delivers messages via callback", () =>
  withSession(async (session) => {
    const q = await session.queue("test-queue-" + Math.random(), { durable: false, autoDelete: true })

    let messageReceived = false
    const sub = await q.subscribe({ noAck: true }, async () => {
      messageReceived = true
    })

    await q.publish("test", { confirm: false })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(messageReceived).toBe(true)
    await sub.cancel()
  }))

test("session.subscribe accepts a broker-named queue", () =>
  withSession(async (session) => {
    const q = await session.queue("", { durable: false, autoDelete: true })

    let messageReceived = false
    const sub = await q.subscribe({ noAck: true }, async () => {
      messageReceived = true
    })

    await q.publish("test", { confirm: false })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(messageReceived).toBe(true)
    await sub.cancel()
  }))

test("subscription.cancel() removes it from session recovery", () =>
  withSession(async (session) => {
    const q = await session.queue("test-cancel-" + Math.random(), { durable: false, autoDelete: true })
    const sub = await q.subscribe({ noAck: true }, () => {})

    await expect(sub.cancel()).resolves.toBeUndefined()
  }))

test("session.subscribe supports prefetch option", () =>
  withSession(async (session) => {
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
  }))

test("session.subscribe yields messages via async generator", () =>
  withSession(async (session) => {
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
  }))

test("session.onfailed fires when maxRetries exhausted", () =>
  withSession(
    async (session) => {
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
    },
    { reconnectInterval: 50, maxRetries: 2 },
  ))

test("session.onconnect fires after successful reconnection", () =>
  withSession(
    async (session) => {
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
    },
    { reconnectInterval: 50, maxRetries: 5 },
  ))

test("subscription recovers and receives messages after reconnection", () =>
  withSession(
    async (session) => {
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
    },
    { reconnectInterval: 50, maxRetries: 5 },
  ))

test("session.stop() during reconnection stops the loop", () =>
  withSession(
    async (session) => {
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
    },
    { reconnectInterval: 200, maxRetries: 10 },
  ))

test("session.stop() when already disconnected does not throw", () =>
  withSession(
    async (session) => {
      ;(testClient(session) as AMQPClient).socket?.destroy()
      await new Promise((resolve) => setTimeout(resolve, 50))

      await expect(session.stop()).resolves.toBeUndefined()
    },
    { maxRetries: 1 },
  ))

test("session.queue() declares a queue and returns AMQPQueue", () =>
  withSession(async (session) => {
    const q = await session.queue("test-sq-" + Math.random(), { durable: false, autoDelete: true })
    expect(q).toBeInstanceOf(AMQPQueue)
    expect(q.name).toMatch(/^test-sq-/)
  }))

test("AMQPQueue (session-backed).publish() and get() round-trip", () =>
  withSession(async (session) => {
    const q = await session.queue("test-sq-rtt-" + Math.random(), { durable: false, autoDelete: true })
    await q.publish("round-trip")

    const msg = await q.get({ noAck: true })
    expect(msg).toBeInstanceOf(AMQPMessage)
    expect(msg?.bodyString()).toBe("round-trip")
  }))

test("AMQPQueue (session-backed).subscribe() recovers after reconnect", () =>
  withSession(
    async (session) => {
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
    },
    { reconnectInterval: 50, maxRetries: 5 },
  ))

test("session.exchange() declares an exchange and returns AMQPExchange", () =>
  withSession(async (session) => {
    const xName = "test-exchange-" + Math.random()

    const x = await session.exchange(xName, "direct", { durable: false, autoDelete: true })
    expect(x).toBeInstanceOf(AMQPExchange)
    expect(x.name).toBe(xName)

    await x.delete()
  }))

test("session.fanoutExchange() publishes to all bound queues", () =>
  withSession(async (session) => {
    const xName = "test-fanout-" + Math.random()
    const qName = "test-fanout-q-" + Math.random()

    const x = await session.fanoutExchange(xName, { durable: false, autoDelete: true })
    const q = await session.queue(qName, { durable: false, autoDelete: true })
    await q.bind(xName, "")

    await x.publish("fanout msg")
    await new Promise((resolve) => setTimeout(resolve, 100))

    const msg = await q.get({ noAck: true })
    expect(msg?.bodyString()).toBe("fanout msg")
  }))

test("session.topicExchange() routes by pattern", () =>
  withSession(async (session) => {
    const xName = "test-topic-" + Math.random()
    const qName = "test-topic-q-" + Math.random()

    const x = await session.topicExchange(xName, { durable: false, autoDelete: true })
    const q = await session.queue(qName, { durable: false, autoDelete: true })
    await q.bind(xName, "events.#")

    await x.publish("topic msg", { routingKey: "events.user.created" })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const msg = await q.get({ noAck: true })
    expect(msg?.bodyString()).toBe("topic msg")
  }))

test("session.directExchange('') returns the default exchange handle", () =>
  withSession(async (session) => {
    const qName = "test-default-x-" + Math.random()

    const x = await session.directExchange("")
    expect(x.name).toBe("")

    const q = await session.queue(qName, { durable: false, autoDelete: true })

    await x.publish("via default exchange", { routingKey: qName })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const msg = await q.get({ noAck: true })
    expect(msg?.bodyString()).toBe("via default exchange")
  }))

test("AMQPExchange.bind() and unbind() work", () =>
  withSession(async (session) => {
    const srcName = "test-xe-src-" + Math.random()
    const dstName = "test-xe-dst-" + Math.random()

    const src = await session.fanoutExchange(srcName, { durable: false, autoDelete: true })
    const dst = await session.fanoutExchange(dstName, { durable: false, autoDelete: true })

    await expect(dst.bind(src)).resolves.toBeInstanceOf(AMQPExchange)
    await expect(dst.unbind(src)).resolves.toBeInstanceOf(AMQPExchange)
  }))

test("AMQPExchange.delete() removes the exchange", () =>
  withSession(async (session) => {
    const xName = "test-del-x-" + Math.random()

    const x = await session.exchange(xName, "direct", { durable: false, autoDelete: false })
    await expect(x.delete()).resolves.toBeUndefined()
  }))

test("AMQPQueue.subscribe() delivers messages via callback", () =>
  withSession(async (session) => {
    const q = await session.queue("test-q-sub-" + Math.random(), { durable: false, autoDelete: true })

    await q.publish("hello queue")
    const received = await new Promise<string>((resolve) => {
      q.subscribe({ noAck: true }, (msg) => resolve(msg.bodyString()!))
    })

    expect(received).toBe("hello queue")
  }))

test("AMQPQueue.subscribe() nack", () =>
  withSession(async (session) => {
    const q = await session.queue("test-q-nack-" + Math.random(), { durable: false, autoDelete: true })

    await q.publish("nack me")
    const msg = await new Promise<AMQPMessage>((resolve) => {
      q.subscribe({ noAck: false }, (m) => {
        m.nack()
        resolve(m)
      })
    })

    expect(msg.bodyString()).toBe("nack me")
  }))

test("AMQPQueue.subscribe() async generator", () =>
  withSession(async (session) => {
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
  }))

test("AMQPQueue.publish({ confirm: false }) sends without waiting for confirm", () =>
  withSession(async (session) => {
    const q = await session.queue("test-q-paf-" + Math.random(), { durable: false, autoDelete: true })

    await q.publish("fire and forget", { confirm: false })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const msg = await q.get({ noAck: true })
    expect(msg?.bodyString()).toBe("fire and forget")
  }))

test("AMQPQueue.bind() and unbind()", () =>
  withSession(async (session) => {
    const q = await session.queue("test-q-bind-" + Math.random(), { durable: false, autoDelete: true })

    await expect(q.bind("amq.topic", "test.key")).resolves.toBeInstanceOf(AMQPQueue)
    await expect(q.unbind("amq.topic", "test.key")).resolves.toBeInstanceOf(AMQPQueue)
  }))

test("AMQPQueue.purge() empties the queue", () =>
  withSession(async (session) => {
    const q = await session.queue("test-q-purge-" + Math.random(), { durable: false, autoDelete: true })

    await q.publish("msg1", { confirm: false })
    await q.publish("msg2", { confirm: false })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const result = await q.purge()
    expect(result.messageCount).toBe(2)
  }))

test("AMQPQueue.delete() removes the queue", () =>
  withSession(async (session) => {
    const q = await session.queue("test-q-del-" + Math.random(), { durable: false, autoDelete: false })

    await expect(q.delete()).resolves.toBeDefined()
  }))

test("AMQPQueue.subscribe() acks message after callback returns", () =>
  withSession(async (session) => {
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
  }))

test("AMQPQueue.subscribe() acks message after successful callback with prefetch", () =>
  withSession(async (session) => {
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
  }))

test("AMQPQueue.subscribe() nacks message when callback throws", () =>
  withSession(async (session) => {
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
  }))

test("AMQPQueue.subscribe() does not ack when noAck is true", () =>
  withSession(async (session) => {
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
  }))

test("AMQPQueue.subscribe() async iterator auto-acks on advance", () =>
  withSession(async (session) => {
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
  }))

test("AMQPQueue.subscribe() async iterator does not ack when noAck is true", () =>
  withSession(async (session) => {
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
  }))

test("AMQPQueue.subscribe() async iterator does not double-ack if message already acked", () =>
  withSession(async (session) => {
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
  }))

test("AMQPQueue.subscribe() does not double-ack if callback already acked", () =>
  withSession(async (session) => {
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
  }))

test("session.rpcClient() and session.rpcServer() round-trip", () =>
  withSession(async (session) => {
    await session.rpcServer("rpc-test-queue", (msg) => {
      return `reply:${msg.bodyString()}`
    })

    const rpc = await session.rpcClient()
    const reply = await rpc.call("rpc-test-queue", "hello")
    expect(reply.bodyString()).toEqual("reply:hello")

    await session.queue("rpc-test-queue").then((q) => q.delete())
  }))

test("session.rpcClient() can do multiple calls", () =>
  withSession(async (session) => {
    await session.rpcServer("rpc-multi-queue", (msg) => {
      return `re:${msg.bodyString()}`
    })

    const rpc = await session.rpcClient()

    const r1 = await rpc.call("rpc-multi-queue", "a")
    expect(r1.bodyString()).toEqual("re:a")

    const r2 = await rpc.call("rpc-multi-queue", "b")
    expect(r2.bodyString()).toEqual("re:b")

    await session.queue("rpc-multi-queue").then((q) => q.delete())
  }))

test("session.rpcCall() one-shot round-trip", () =>
  withSession(async (session) => {
    await session.rpcServer("rpc-oneshot-queue", (msg) => {
      return `got:${msg.bodyString()}`
    })

    const reply = await session.rpcCall("rpc-oneshot-queue", "ping")
    expect(reply.bodyString()).toEqual("got:ping")

    await session.queue("rpc-oneshot-queue").then((q) => q.delete())
  }))

test("session.rpcClient() rejects on timeout", () =>
  withSession(async (session) => {
    // Declare queue so the message routes somewhere, but no consumer to reply
    await session.queue("rpc-timeout-queue")

    const rpc = await session.rpcClient()

    await expect(rpc.call("rpc-timeout-queue", "hello", { timeout: 100 })).rejects.toThrow(/No response received/)

    await session.queue("rpc-timeout-queue").then((q) => q.delete())
  }))

test("session.rpcClient() close rejects pending calls", () =>
  withSession(async (session) => {
    await session.queue("rpc-close-queue")

    const rpc = await session.rpcClient()

    const pending = rpc.call("rpc-close-queue", "hello")
    const expectRejection = expect(pending).rejects.toThrow(/RPC client closed|Channel is closed/)
    await rpc.close()

    await expectRejection
    await session.queue("rpc-close-queue").then((q) => q.delete())
  }))

// --- Codec registry integration tests ---

async function withCodecSession(
  fn: (session: AMQPSession<"codec">) => Promise<void>,
  codecOpts?: { defaultContentType?: string; defaultContentEncoding?: string },
): Promise<void> {
  const codecs = new AMQPCodecRegistry().enableBuiltinCodecs()
  const session = await AMQPSession.connect("amqp://127.0.0.1", { codecs, ...codecOpts })
  try {
    await fn(session)
  } finally {
    await session.stop()
  }
}

test("codec: publish JSON object and parse via callback", () =>
  withCodecSession(async (session) => {
    const q = await session.queue("test-codec-json-" + Math.random(), { durable: false, autoDelete: true })
    const obj = { users: ["alice", "bob"], count: 2 }

    await q.publish(obj, { contentType: "application/json" })

    let parsed: unknown
    const sub = await q.subscribe({ noAck: true }, async (msg) => {
      parsed = msg.body
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(parsed).toEqual(obj)
    await sub.cancel()
  }))

test("codec: publish with default contentType", () =>
  withCodecSession(
    async (session) => {
      const q = await session.queue("test-codec-default-ct-" + Math.random(), { durable: false, autoDelete: true })

      await q.publish({ key: "value" })

      const msg = await q.get({ noAck: true })
      expect(msg).not.toBeNull()
      expect(msg!.properties.contentType).toBe("application/json")
      expect(msg!.body).toEqual({ key: "value" })
    },
    { defaultContentType: "application/json" },
  ))

test("codec: explicit contentType overrides default", () =>
  withCodecSession(
    async (session) => {
      const q = await session.queue("test-codec-override-" + Math.random(), { durable: false, autoDelete: true })

      await q.publish("plain text", { contentType: "text/plain" })

      const msg = await q.get({ noAck: true })
      expect(msg!.properties.contentType).toBe("text/plain")
      expect(msg!.body).toBe("plain text")
    },
    { defaultContentType: "application/json" },
  ))

test("codec: JSON + gzip round-trip via get", () =>
  withCodecSession(async (session) => {
    const q = await session.queue("test-codec-gzip-" + Math.random(), { durable: false, autoDelete: true })
    const data = { compressed: true, items: [1, 2, 3] }

    await q.publish(data, { contentType: "application/json", contentEncoding: "gzip" })

    const msg = await q.get({ noAck: true })
    expect(msg).not.toBeNull()
    expect(msg!.properties.contentEncoding).toBe("gzip")
    expect(msg!.body).toEqual(data)
  }))

test("codec: default contentEncoding compresses automatically", () =>
  withCodecSession(
    async (session) => {
      const q = await session.queue("test-codec-default-ce-" + Math.random(), { durable: false, autoDelete: true })

      await q.publish({ auto: "compressed" })

      const msg = await q.get({ noAck: true })
      expect(msg!.properties.contentType).toBe("application/json")
      expect(msg!.properties.contentEncoding).toBe("gzip")
      expect(msg!.body).toEqual({ auto: "compressed" })
    },
    { defaultContentType: "application/json", defaultContentEncoding: "gzip" },
  ))

test("codec: async generator receives decoded messages", () =>
  withCodecSession(
    async (session) => {
      const q = await session.queue("test-codec-gen-" + Math.random(), { durable: false, autoDelete: true })

      await q.publish({ n: 1 })
      await q.publish({ n: 2 })

      const results: unknown[] = []
      const sub = await q.subscribe({ noAck: true })
      for await (const msg of sub) {
        results.push(msg.body)
        if (results.length >= 2) break
      }

      expect(results).toEqual([{ n: 1 }, { n: 2 }])
      await sub.cancel()
    },
    { defaultContentType: "application/json" },
  ))

test("codec: exchange publish encodes messages", () =>
  withCodecSession(async (session) => {
    const xName = "test-codec-x-" + Math.random()
    const qName = "test-codec-xq-" + Math.random()

    const x = await session.fanoutExchange(xName, { durable: false, autoDelete: true })
    const q = await session.queue(qName, { durable: false, autoDelete: true })
    await q.bind(xName, "")

    await x.publish({ via: "exchange" }, { contentType: "application/json" })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const msg = await q.get({ noAck: true })
    expect(msg).not.toBeNull()
    expect(msg!.body).toEqual({ via: "exchange" })
  }))

test("codec: no codecs configured leaves messages untouched", () =>
  withSession(async (session) => {
    const q = await session.queue("test-no-codec-" + Math.random(), { durable: false, autoDelete: true })

    await q.publish("raw string")

    const msg = await q.get({ noAck: true })
    expect(msg?.bodyString()).toBe("raw string")
    // body is raw Uint8Array when no codecs configured
    expect(msg!.rawBody).toBeInstanceOf(Uint8Array)
  }))

test("codec: rpcClient and rpcServer round-trip with JSON encoding", () =>
  withCodecSession(
    async (session) => {
      await session.rpcServer("rpc-codec-queue", async (msg) => {
        return { echo: msg.body }
      })

      const rpc = await session.rpcClient()
      const reply = await rpc.call("rpc-codec-queue", { greeting: "hello" })

      expect(reply.properties.contentType).toBe("application/json")
      expect(reply.body).toEqual({ echo: { greeting: "hello" } })

      await rpc.close()
      await session.queue("rpc-codec-queue").then((q) => q.delete())
    },
    { defaultContentType: "application/json" },
  ))

test("codec: rpcCall one-shot with JSON encoding", () =>
  withCodecSession(
    async (session) => {
      await session.rpcServer("rpc-codec-oneshot", async (msg) => {
        return { got: msg.body }
      })

      const reply = await session.rpcCall("rpc-codec-oneshot", { ping: true })
      expect(reply.body).toEqual({ got: { ping: true } })

      await session.queue("rpc-codec-oneshot").then((q) => q.delete())
    },
    { defaultContentType: "application/json" },
  ))

test("subscribe callback receives AMQPMessage with rawBody", () =>
  withSession(async (session) => {
    const q = await session.queue("test-sm-type-" + Math.random(), { durable: false, autoDelete: true })
    await q.publish("check type")

    const msg = await new Promise<AMQPMessage>((resolve) => {
      q.subscribe({ noAck: true }, (m) => resolve(m))
    })

    expect(msg).toBeInstanceOf(AMQPMessage)
    expect(msg.rawBody).toBeInstanceOf(Uint8Array)
  }))

test("get() returns AMQPMessage with rawBody", () =>
  withSession(async (session) => {
    const q = await session.queue("test-sm-get-" + Math.random(), { durable: false, autoDelete: true })
    await q.publish("check get")

    const msg = await q.get({ noAck: true })
    expect(msg).toBeInstanceOf(AMQPMessage)
    expect(msg!.rawBody).toBeInstanceOf(Uint8Array)
  }))
