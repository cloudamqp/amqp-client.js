import { expect, test, vi, beforeEach } from "vitest"
import { AMQPClient } from "../src/amqp-socket-client.js"
import { AMQPSession } from "../src/amqp-session.js"
import type { AMQPSessionOptions } from "../src/amqp-session.js"
import { AMQPQueue } from "../src/amqp-queue.js"
import { AMQPExchange } from "../src/amqp-exchange.js"
import { AMQPMessage } from "../src/amqp-message.js"
import { builtinParsers, builtinCoders } from "../src/amqp-codec-registry.js"
import type { AMQPParser } from "../src/amqp-codec-registry.js"
import type { AMQPBaseClient } from "../src/amqp-base-client.js"

beforeEach(() => {
  expect.hasAssertions()
})

/** Access the private client for test-only operations (socket destruction, spying). */
function testClient(session: AMQPSession): AMQPBaseClient {
  return (session as unknown as { client: AMQPBaseClient }).client
}

async function withSession(fn: (session: AMQPSession) => Promise<void>, options?: AMQPSessionOptions): Promise<void> {
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

test("subscribe: a throwing no-ack callback is logged, not an unhandled rejection", async () => {
  const error = vi.fn()
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error }
  await withSession(
    async (session) => {
      const q = await session.queue("test-throwing-cb-" + Math.random(), { durable: false, autoDelete: true })
      const sub = await q.subscribe({ noAck: true }, () => {
        throw new Error("boom")
      })

      await q.publish("test", { confirm: false })
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(error).toHaveBeenCalled()
      await sub.cancel()
    },
    { logger },
  )
})

test("subscribe: a decode failure is logged, not an unhandled rejection", async () => {
  const error = vi.fn()
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error }
  await withSession(
    async (session) => {
      const q = await session.queue("test-bad-decode-" + Math.random(), { durable: false, autoDelete: true })
      let delivered = false
      const sub = await q.subscribe({ noAck: true }, () => {
        delivered = true
      })

      // Publish raw so the body bypasses serialization: claims JSON, isn't.
      const ch = await testClient(session).channel()
      await ch.basicPublish("", q.name, "not json {", { contentType: "application/json" })
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(error).toHaveBeenCalled()
      expect(delivered).toBe(false)
      await ch.close()
      await sub.cancel()
    },
    { logger, parsers: builtinParsers },
  )
})

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

test("server-named queues are not tracked for recovery", () =>
  withSession(async (session) => {
    const queues = (session as unknown as { queues: Map<string, AMQPQueue> }).queues

    // A server-named queue ("") gets a fresh broker-assigned name on every
    // connection, so the old name can't be recovered after a reconnect.
    // It must not be registered for auto-recovery — otherwise the dead
    // amq.gen-* name would be chased (and never evicted) on each reconnect.
    const sizeBefore = queues.size
    const anon = await session.queue("", { exclusive: true, autoDelete: true })
    expect(anon.name).not.toBe("")
    expect(queues.size).toBe(sizeBefore)

    // Named queues are still tracked so their consumers recover.
    const named = "test-tracked-" + Math.random()
    await session.queue(named, { durable: false, autoDelete: true })
    expect(queues.has(named)).toBe(true)
    await (await session.queue(named)).delete()
  }))

test("subscription.cancel() removes it from session recovery", () =>
  withSession(async (session) => {
    const q = await session.queue("test-cancel-" + Math.random(), { durable: false, autoDelete: true })
    const sub = await q.subscribe({ noAck: true }, () => {})

    await expect(sub.cancel()).resolves.toBeUndefined()
  }))

test("subscription.cancel() closes the dedicated channel", () =>
  withSession(async (session) => {
    const q = await session.queue("test-cancel-channel-" + Math.random(), { durable: false, autoDelete: true })
    const sub = await q.subscribe({ noAck: true }, () => {})
    const ch = sub.channel

    expect(ch.closed).toBe(false)
    await sub.cancel()
    expect(ch.closed).toBe(true)
  }))

test("repeated subscribe/cancel does not leak channels", () =>
  withSession(async (session) => {
    // autoDelete: false so the queue survives between subscribe/cancel cycles.
    const q = await session.queue("test-cancel-leak-" + Math.random(), { durable: false, autoDelete: false })
    try {
      const client = testClient(session)
      const openCount = () => client.channels.filter(Boolean).length
      const before = openCount()

      for (let i = 0; i < 5; i++) {
        const sub = await q.subscribe({ noAck: true }, () => {})
        await sub.cancel()
      }

      expect(openCount()).toBe(before)
    } finally {
      await q.delete()
    }
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

test("onfailed fires when maxRetries exhausted", async () => {
  const onfailed = vi.fn()
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 50,
    maxRetries: 2,
    onfailed,
  })
  try {
    const client = testClient(session)
    const connectSpy = vi.spyOn(client, "connect").mockRejectedValue(new Error("forced failure"))

    ;(client as AMQPClient).socket?.destroy()

    // Wait long enough for 2 retries + backoff (50ms + 100ms) with buffer
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(onfailed).toHaveBeenCalledTimes(1)
    expect(onfailed.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(connectSpy).toHaveBeenCalledTimes(2)

    connectSpy.mockRestore()
  } finally {
    await session.stop()
  }
})

test("onconnect fires on the initial connect", async () => {
  const onconnect = vi.fn()
  const session = await AMQPSession.connect("amqp://127.0.0.1", { onconnect })
  try {
    expect(onconnect).toHaveBeenCalledTimes(1)
  } finally {
    await session.stop()
  }
})

test("onconnect receives the session — usable on initial connect before AMQPSession.connect() returns", async () => {
  // The pattern this enables: declare a server-named queue once inside
  // `onconnect` and trust the same handler will re-run on every reconnect.
  // No chicken-and-egg with the outer `session` variable.
  const names: string[] = []
  let resolveFirst!: () => void
  let resolveSecond!: () => void
  const firstReady = new Promise<void>((r) => (resolveFirst = r))
  const secondReady = new Promise<void>((r) => (resolveSecond = r))
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 50,
    maxRetries: 5,
    onconnect: (s) => {
      void (async () => {
        const q = await s.queue("", { exclusive: true, autoDelete: true })
        names.push(q.name)
        ;(names.length === 1 ? resolveFirst : resolveSecond)()
      })()
    },
  })
  try {
    await firstReady
    expect(names).toHaveLength(1)
    ;(testClient(session) as AMQPClient).socket?.destroy()
    await secondReady
    expect(names).toHaveLength(2)
    expect(names[0]).not.toBe(names[1])
  } finally {
    await session.stop()
  }
})

test("onconnect fires after successful reconnection", async () => {
  let count = 0
  const reconnected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("onconnect did not fire within 5s")), 5_000)
    const session = AMQPSession.connect("amqp://127.0.0.1", {
      reconnectInterval: 50,
      maxRetries: 5,
      onconnect: () => {
        count++
        if (count === 2) {
          clearTimeout(timeout)
          resolve()
        }
      },
    })
    session.then((s) => (testClient(s) as AMQPClient).socket?.destroy()).catch(reject)
  })
  await reconnected
  expect(count).toBe(2)
})

test("ondisconnect fires when the connection drops", async () => {
  const ondisconnect = vi.fn()
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    reconnectInterval: 50,
    maxRetries: 5,
    ondisconnect,
  })
  try {
    ;(testClient(session) as AMQPClient).socket?.destroy()
    // Give the disconnect callback time to fire before the reconnect kicks in.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(ondisconnect).toHaveBeenCalledTimes(1)
  } finally {
    await session.stop()
  }
})

test("logger: logs initial connect, disconnect, reconnect with name prefix", async () => {
  let resolveReconnected!: () => void
  const reconnected = new Promise<void>((resolve, reject) => {
    resolveReconnected = resolve
    setTimeout(() => reject(new Error("Reconnection timed out")), 10_000)
  })
  const info = vi.fn((msg: string) => {
    if (msg === "AMQPSession[my-app]: reconnected") resolveReconnected()
  })
  const warn = vi.fn()
  const logger = { debug: vi.fn(), info, warn, error: vi.fn() }
  const session = await AMQPSession.connect("amqp://127.0.0.1?name=my-app", {
    logger,
    reconnectInterval: 50,
    maxRetries: 5,
  })
  try {
    expect(info).toHaveBeenCalledWith("AMQPSession[my-app]: connected")
    ;(testClient(session) as AMQPClient).socket?.destroy()
    await reconnected
    expect(warn).toHaveBeenCalledWith("AMQPSession[my-app]: disconnected")
    expect(info).toHaveBeenCalledWith("AMQPSession[my-app]: reconnected")
  } finally {
    await session.stop()
  }
})

test("logger: logs reconnect gave up when maxRetries exhausted", async () => {
  const error = vi.fn()
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error }
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    logger,
    reconnectInterval: 50,
    maxRetries: 2,
  })
  try {
    const client = testClient(session)
    const connectSpy = vi.spyOn(client, "connect").mockRejectedValue(new Error("forced failure"))
    ;(client as AMQPClient).socket?.destroy()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(error).toHaveBeenCalledWith("AMQPSession: reconnect gave up")
    connectSpy.mockRestore()
  } finally {
    await session.stop()
  }
})

test("subscription recovers and receives messages after reconnection", async () => {
  let connectCount = 0
  let resolveReconnected!: () => void
  const reconnected = new Promise<void>((resolve, reject) => {
    resolveReconnected = resolve
    setTimeout(() => reject(new Error("Reconnection timed out")), 10_000)
  })
  await withSession(
    async (session) => {
      const q = await session.queue("test-recovery-" + Math.random(), { durable: false, autoDelete: false })

      const received: string[] = []
      const sub = await q.subscribe({ noAck: true }, (msg) => {
        received.push(msg.bodyString() || "")
      })

      // Publish a message before disconnect
      await q.publish("before-disconnect", { confirm: false })
      await new Promise((resolve) => setTimeout(resolve, 100))
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
    {
      reconnectInterval: 50,
      maxRetries: 5,
      onconnect: () => {
        connectCount++
        if (connectCount === 2) resolveReconnected()
      },
    },
  )
})

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

test("session.queue(name) re-call returns cached handle without redeclaring", () =>
  withSession(async (session) => {
    const name = "test-sq-redecl-" + Math.random()
    const first = await session.queue(name, { durable: false, autoDelete: true })
    // Without the cache, a bare re-call would default durable: true (since
    // name !== "") and trip PRECONDITION_FAILED against the durable: false
    // original. The same applies to a re-call with {}.
    const second = await session.queue(name)
    const third = await session.queue(name, {})
    expect(second).toBe(first)
    expect(third).toBe(first)
    await first.delete()
  }))

test("queue.delete() invalidates the session cache so re-declare returns a fresh handle", () =>
  withSession(async (session) => {
    const name = "test-sq-delete-cache-" + Math.random()
    const first = await session.queue(name, { durable: false, autoDelete: true })
    await first.delete()
    // After delete, the cache entry must be gone — re-declaring with
    // different params would otherwise return the stale handle and skip
    // the new declare entirely.
    const second = await session.queue(name, { durable: false, autoDelete: true })
    expect(second).not.toBe(first)
    await second.delete()
  }))

test("queue.delete() lets a re-declare succeed with conflicting params (cache cleared)", () =>
  withSession(async (session) => {
    const name = "test-sq-delete-redecl-" + Math.random()
    const first = await session.queue(name, { durable: false, autoDelete: true, exclusive: false })
    await first.delete()
    // If the cache were still populated, this call would hand back `first`
    // without redeclaring; with the cache cleared the broker accepts the
    // fresh declaration with a different `exclusive` value.
    const second = await session.queue(name, { durable: false, autoDelete: true, exclusive: true })
    expect(second).not.toBe(first)
    await second.delete()
  }))

test("queue.delete() cancels active subscriptions", () =>
  withSession(async (session) => {
    const name = "test-sq-delete-cancel-" + Math.random()
    const q = await session.queue(name, { durable: false, autoDelete: false })
    const sub = await q.subscribe(() => {})
    const ch = sub.channel
    expect(ch.closed).toBe(false)
    await q.delete()
    // cancelAll runs synchronously but the consumer cancel + channel close
    // are async; wait a tick for the broker round-trip.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(ch.closed).toBe(true)
  }))

test("queue.delete() failure keeps the cache entry (handle still usable)", () =>
  withSession(async (session) => {
    const name = "test-sq-delete-fail-" + Math.random()
    const q = await session.queue(name, { durable: false, autoDelete: true })
    await q.publish("blocker")
    // ifEmpty against a non-empty queue → PRECONDITION_FAILED. Cache must
    // stay intact since the queue still exists broker-side.
    await expect(q.delete({ ifEmpty: true })).rejects.toThrow()
    const again = await session.queue(name)
    expect(again).toBe(q)
    await q.delete()
  }))

test("AMQPQueue (session-backed).publish() and get() round-trip", () =>
  withSession(async (session) => {
    const q = await session.queue("test-sq-rtt-" + Math.random(), { durable: false, autoDelete: true })
    await q.publish("round-trip")

    const msg = await q.get({ noAck: true })
    expect(msg).toBeInstanceOf(AMQPMessage)
    expect(msg?.bodyString()).toBe("round-trip")
  }))

test("AMQPQueue.publish() defaults deliveryMode to 2 (persistent)", () =>
  withSession(async (session) => {
    const q = await session.queue("test-sq-persist-" + Math.random(), { durable: false, autoDelete: true })
    await q.publish("default")

    const msg = await q.get({ noAck: true })
    expect(msg?.properties.deliveryMode).toBe(2)
  }))

test("AMQPQueue.publish() honors explicit deliveryMode: 1 (transient)", () =>
  withSession(async (session) => {
    const q = await session.queue("test-sq-transient-" + Math.random(), { durable: false, autoDelete: true })
    await q.publish("transient", { deliveryMode: 1 })

    const msg = await q.get({ noAck: true })
    expect(msg?.properties.deliveryMode).toBe(1)
  }))

test("AMQPExchange.publish() defaults deliveryMode to 2 (persistent)", () =>
  withSession(async (session) => {
    const xName = "test-x-persist-" + Math.random()
    const qName = "test-xq-persist-" + Math.random()
    const x = await session.fanoutExchange(xName, { durable: false, autoDelete: true })
    const q = await session.queue(qName, { durable: false, autoDelete: true })
    await q.bind(x)

    await x.publish("default")
    await new Promise((resolve) => setTimeout(resolve, 50))

    const msg = await q.get({ noAck: true })
    expect(msg?.properties.deliveryMode).toBe(2)
  }))

test("AMQPExchange.publish() honors explicit deliveryMode: 1 (transient)", () =>
  withSession(async (session) => {
    const xName = "test-x-transient-" + Math.random()
    const qName = "test-xq-transient-" + Math.random()
    const x = await session.fanoutExchange(xName, { durable: false, autoDelete: true })
    const q = await session.queue(qName, { durable: false, autoDelete: true })
    await q.bind(x)

    await x.publish("transient", { deliveryMode: 1 })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const msg = await q.get({ noAck: true })
    expect(msg?.properties.deliveryMode).toBe(1)
  }))

test("AMQPQueue (session-backed).subscribe() recovers after reconnect", async () => {
  let connectCount = 0
  let resolveReconnected!: () => void
  const reconnected = new Promise<void>((resolve, reject) => {
    resolveReconnected = resolve
    setTimeout(() => reject(new Error("reconnect timed out")), 10_000)
  })
  await withSession(
    async (session) => {
      const qName = "test-sq-recovery-" + Math.random()

      const q = await session.queue(qName, { durable: false, autoDelete: false })

      const received: string[] = []
      const sub = await q.subscribe({ noAck: true }, (msg) => {
        received.push(msg.bodyString() ?? "")
      })

      await q.publish("before-disconnect")
      await new Promise((resolve) => setTimeout(resolve, 100))
      ;(testClient(session) as AMQPClient).socket?.destroy()
      await reconnected

      await q.publish("after-reconnect")
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(received).toContain("before-disconnect")
      expect(received).toContain("after-reconnect")

      await sub.cancel()
      await q.delete()
    },
    {
      reconnectInterval: 50,
      maxRetries: 5,
      onconnect: () => {
        connectCount++
        if (connectCount === 2) resolveReconnected()
      },
    },
  )
})

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

test("AMQPQueue.bind() and unbind() accept an AMQPExchange handle", () =>
  withSession(async (session) => {
    const x = await session.topicExchange("amq.topic")
    const q = await session.queue("test-q-bind-handle-" + Math.random(), { durable: false, autoDelete: true })

    await expect(q.bind(x, "test.key")).resolves.toBeInstanceOf(AMQPQueue)
    await expect(q.unbind(x, "test.key")).resolves.toBeInstanceOf(AMQPQueue)
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
const csvSimpleParser: AMQPParser<string, string> = {
  serialize: (body: string): Uint8Array => {
    return new TextEncoder().encode(
      body
        .split(",")
        .map((s) => s.trim())
        .join(","),
    )
  },
  parse: (body: Uint8Array): string => {
    return new TextDecoder().decode(body)
  },
}
const parsers = { ...builtinParsers, "csv/simple": csvSimpleParser }
const coders = builtinCoders

async function withCodecSession(
  fn: (
    session: AMQPSession<typeof parsers, typeof coders, keyof typeof parsers & string, keyof typeof coders & string>,
  ) => Promise<void>,
  codecOpts?: {
    defaultContentType?: keyof typeof parsers & string
    defaultContentEncoding?: keyof typeof coders & string
  },
): Promise<void> {
  const options = { parsers, coders, ...(codecOpts ?? {}) }
  const session = await AMQPSession.connect("amqp://127.0.0.1", options)
  try {
    await fn(session)
  } finally {
    await session.stop()
  }
}

test("codec: publish JSON object and parse via callback", () =>
  withCodecSession(
    async (session) => {
      const q = await session.queue("test-codec-json-" + Math.random(), { durable: false, autoDelete: true })
      const obj = { users: ["alice", "bob"], count: 2 }

      await q.publish(obj)

      let parsed: unknown
      const sub = await q.subscribe({ noAck: true }, async (msg) => {
        parsed = msg.body
      })
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(parsed).toEqual(obj)
      await sub.cancel()
    },
    { defaultContentType: "application/json" },
  ))

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
    expect(msg!.body).toBeInstanceOf(Uint8Array)
  }))

test("codec: rpcClient and rpcServer round-trip with JSON encoding", () =>
  withCodecSession(
    async (session) => {
      await session.rpcServer("rpc-codec-queue", async (msg) => {
        return { echo: msg.body } as import("../src/amqp-codec-registry.js").JsonSerializable
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
        return { got: msg.body } as import("../src/amqp-codec-registry.js").JsonSerializable
      })

      const reply = await session.rpcCall("rpc-codec-oneshot", { ping: true })
      expect(reply.body).toEqual({ got: { ping: true } })

      await session.queue("rpc-codec-oneshot").then((q) => q.delete())
    },
    { defaultContentType: "application/json" },
  ))

test("subscribe callback receives AMQPMessage with body", () =>
  withSession(async (session) => {
    const q = await session.queue("test-sm-type-" + Math.random(), { durable: false, autoDelete: true })
    await q.publish("check type")

    const msg = await new Promise<AMQPMessage>((resolve) => {
      q.subscribe({ noAck: true }, (m) => resolve(m))
    })

    expect(msg).toBeInstanceOf(AMQPMessage)
    expect(msg.body).toBeInstanceOf(Uint8Array)
  }))

test("get() returns AMQPMessage with body", () =>
  withSession(async (session) => {
    const q = await session.queue("test-sm-get-" + Math.random(), { durable: false, autoDelete: true })
    await q.publish("check get")

    const msg = await q.get({ noAck: true })
    expect(msg).toBeInstanceOf(AMQPMessage)
    expect(msg!.body).toBeInstanceOf(Uint8Array)
  }))

test("ops channel: passive NOT_FOUND doesn't disrupt concurrent declares", () =>
  withSession(async (session) => {
    // Without the ops-channel mutex, the broker's NOT_FOUND close on the
    // passive RPC would also fail concurrent declares in flight on the
    // shared ops channel with a generic "channel closed" error.
    const okName = "test-passive-concurrent-" + Math.random()
    const results = await Promise.allSettled([
      session.queue("nope-" + Math.random(), { passive: true }),
      session.queue(okName, { durable: false, autoDelete: true }),
    ])

    expect(results[0]?.status).toBe("rejected")
    if (results[0]?.status === "rejected") {
      expect(String(results[0].reason)).toMatch(/NOT[_-]?FOUND/i)
    }
    expect(results[1]?.status).toBe("fulfilled")
  }))

test("ops channel: passive NOT_FOUND doesn't log a connection error and recovers", async () => {
  // Passive declare of a missing queue closes the ops channel. The miss must
  // not log a connection error, and the channel must recover.
  const error = vi.fn()
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error }
  await withSession(
    async (session) => {
      await expect(session.queue("nope-" + Math.random(), { passive: true })).rejects.toThrow(/NOT[_-]?FOUND/i)
      expect(error).not.toHaveBeenCalled()

      // Ops channel recovered: a follow-up declare on the shared channel works.
      const okName = "test-after-passive-miss-" + Math.random()
      const q = await session.queue(okName, { durable: false, autoDelete: true })
      expect(q).toBeInstanceOf(AMQPQueue)
      await q.delete()
      expect(error).not.toHaveBeenCalled()
    },
    { logger },
  )
})

test("ops channel: PRECONDITION_FAILED on mismatched declare doesn't disrupt siblings", () =>
  withSession(async (owner) => {
    // Declare the queue from one session, then from a second session declare
    // it with conflicting args concurrently with an unrelated declare. The
    // conflict closes the second session's ops channel — without the mutex
    // the sibling declare would fail too. Two sessions because cache-wins
    // makes a same-session re-declare a no-op.
    const name = "test-precondition-" + Math.random()
    const queue = await owner.queue(name, { durable: false, autoDelete: true })
    try {
      await withSession(async (session) => {
        const okName = "test-precondition-sibling-" + Math.random()
        const results = await Promise.allSettled([
          session.queue(name, { durable: true }),
          session.queue(okName, { durable: false, autoDelete: true }),
        ])

        expect(results[0]?.status).toBe("rejected")
        expect(results[1]?.status).toBe("fulfilled")
      })
    } finally {
      await queue.delete()
    }
  }))

test("subscription.cancel() swallows underlying consumer errors", () =>
  withSession(async (session) => {
    const q = await session.queue("test-cancel-throws-" + Math.random(), {
      durable: false,
      autoDelete: true,
    })
    const sub = await q.subscribe({ noAck: true }, () => {})

    // Simulate the broker/channel dropping mid-cancel: stub the consumer's
    // cancel to reject. Real-world equivalents include channel close
    // racing with the basic.cancel RPC, broker errors during cancel, or
    // the connection going away between the closed-check and the wire.
    // Without the best-effort guard in AMQPSubscription.cancel, the
    // rejection bubbles up and forces every caller to `.catch(() => {})`.
    const internal = sub as unknown as { consumer: { cancel(): Promise<unknown> } }
    internal.consumer.cancel = () => Promise.reject(new Error("simulated cancel failure"))

    await expect(sub.cancel()).resolves.toBeUndefined()
  }))

test("queue options: arguments bundle alongside declaration parameters, no positional undefined", () =>
  withSession(async (session) => {
    const name = "test-options-bag-" + Math.random()
    const q = await session.queue(name, {
      durable: false,
      autoDelete: true,
      arguments: { "x-message-ttl": 30_000 },
    })
    expect(q.name).toBe(name)
    // Re-declaring with a mismatched ttl would close the channel —
    // success here proves the arguments round-tripped on the original declare.
    await session.queue(name, {
      durable: false,
      autoDelete: true,
      arguments: { "x-message-ttl": 30_000 },
    })
  }))

test("AMQPSession is structurally assignable to AMQPSessionLike (compile-time)", () => {
  // Pure type assertion — the import must compile, and the assignment
  // must satisfy AMQPSessionLike. No runtime broker calls.
  const checkAssignable = (session: AMQPSession): import("../src/amqp-mockable.js").AMQPSessionLike => session
  expect(typeof checkAssignable).toBe("function")
})

test("consumeOne resolves with the next delivered message and cancels the consumer", () =>
  withSession(async (session) => {
    // autoDelete:false so the queue survives the cancel inside consumeOne
    // — otherwise the second-message assertion races queue teardown.
    const q = await session.queue("test-consumeone-" + Math.random(), { durable: false, autoDelete: false })
    try {
      await q.publish("first")
      await q.publish("second")

      const msg = await q.consumeOne({ timeout: 1_000 })
      expect(msg.bodyString()).toBe("first")

      // consumeOne cancels its consumer after resolving, so the second
      // message stays in the queue and basic.get can fetch it.
      const remaining = await q.get({ noAck: true })
      expect(remaining?.bodyString()).toBe("second")
    } finally {
      await q.delete()
    }
  }))

test("consumeOne throws on timeout", () =>
  withSession(async (session) => {
    const q = await session.queue("test-consumeone-timeout-" + Math.random(), {
      durable: false,
      autoDelete: true,
    })
    await expect(q.consumeOne({ timeout: 100 })).rejects.toThrow(/consumeOne timed out after 100ms/)
  }))

test("consumeOne with no timeout waits forever (cancelled via timer)", () =>
  withSession(async (session) => {
    const q = await session.queue("test-consumeone-notimeout-" + Math.random(), {
      durable: false,
      autoDelete: true,
    })
    // Race the indefinite wait against a sentinel that publishes after a delay.
    setTimeout(() => void q.publish("delivered"), 50)
    const msg = await q.consumeOne()
    expect(msg.bodyString()).toBe("delivered")
  }))

test("consumeOne closes its dedicated channel on timeout (no leak)", () =>
  withSession(async (session) => {
    const q = await session.queue("test-consumeone-noleak-" + Math.random(), {
      durable: false,
      autoDelete: true,
    })
    const before = Object.keys(testClient(session).channels).length
    await expect(q.consumeOne({ timeout: 50 })).rejects.toThrow(/timed out/)
    // Wait a tick for cleanup's channel-close to finalize.
    await new Promise((r) => setTimeout(r, 20))
    const after = Object.keys(testClient(session).channels).length
    expect(after).toBe(before)
  }))

test("consumeOne rejects when the connection drops before delivery", () =>
  withSession(
    async (session) => {
      const q = await session.queue("test-consumeone-drop-" + Math.random(), {
        durable: false,
        autoDelete: true,
      })
      const pending = q.consumeOne() // no timeout — would hang forever without close-detection
      // Yield once so the consumer registers before we kill the socket.
      await new Promise((r) => setTimeout(r, 50))
      ;(testClient(session) as AMQPClient).socket?.destroy()
      await expect(pending).rejects.toThrow()
    },
    { reconnectInterval: 50, maxRetries: 1 },
  ))

test("name option sets connection name (overrides URL query)", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1?name=from-url", { name: "from-option" })
  try {
    expect(testClient(session).name).toBe("from-option")
  } finally {
    await session.stop()
  }
})

test("heartbeat option negotiates with broker", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", { heartbeat: 30 })
  try {
    // The broker may negotiate down, but 30 is well within RabbitMQ defaults.
    expect(testClient(session).heartbeat).toBe(30)
  } finally {
    await session.stop()
  }
})

test("frameMax option negotiates with broker", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", { frameMax: 16384 })
  try {
    expect(testClient(session).frameMax).toBe(16384)
  } finally {
    await session.stop()
  }
})

test("channelMax option negotiates with broker", async () => {
  const session = await AMQPSession.connect("amqp://127.0.0.1", { channelMax: 64 })
  try {
    expect(testClient(session).channelMax).toBe(64)
  } finally {
    await session.stop()
  }
})

test("mandatory publish to unroutable address triggers onreturn", async () => {
  let returned!: (msg: AMQPMessage) => void
  const got = new Promise<AMQPMessage>((resolve) => {
    returned = resolve
  })
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    onreturn: (msg) => returned(msg),
  })
  try {
    // Default exchange routes by queue name. No queue with this name exists, so
    // mandatory:true makes the broker return the message.
    const q = new AMQPQueue(session, "does-not-exist-" + Math.random())
    await q.publish("hello", { mandatory: true, confirm: false })
    const msg = await Promise.race([
      got,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("onreturn never fired")), 2000)),
    ])
    expect(msg.routingKey).toBe(q.name)
  } finally {
    await session.stop()
  }
})

test("mandatory publish that routes does not trigger onreturn", async () => {
  const onreturn = vi.fn()
  const session = await AMQPSession.connect("amqp://127.0.0.1", { onreturn })
  try {
    const q = await session.queue("test-mandatory-routes-" + Math.random(), {
      durable: false,
      autoDelete: true,
    })
    await q.publish("hello", { mandatory: true })
    await new Promise((r) => setTimeout(r, 100))
    expect(onreturn).not.toHaveBeenCalled()
  } finally {
    await session.stop()
  }
})

test("returned messages are decoded via session parsers before onreturn", async () => {
  let returned!: (msg: AMQPMessage) => void
  const got = new Promise<AMQPMessage>((resolve) => {
    returned = resolve
  })
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    parsers: builtinParsers,
    defaultContentType: "application/json",
    onreturn: (msg) => returned(msg),
  })
  try {
    const q = new AMQPQueue(session, "does-not-exist-" + Math.random())
    await q.publish({ hello: "world" }, { mandatory: true, confirm: false })
    const msg = await Promise.race([
      got,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("onreturn never fired")), 2000)),
    ])
    expect(msg.body).toEqual({ hello: "world" })
  } finally {
    await session.stop()
  }
})

test("beforeConnect runs and is awaited before the initial connect", async () => {
  let ranBeforeConnect = false
  const session = await AMQPSession.connect("amqp://127.0.0.1", {
    beforeConnect: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      ranBeforeConnect = true
    },
  })
  try {
    // connect() only resolves after the awaited beforeConnect completes.
    expect(ranBeforeConnect).toBe(true)
    expect(session.closed).toBe(false)
  } finally {
    await session.stop()
  }
})

test("beforeConnect runs again before each reconnect", async () => {
  let connects = 0
  let befores = 0
  const reconnected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("did not reconnect within 5s")), 5_000)
    AMQPSession.connect("amqp://127.0.0.1", {
      reconnectInterval: 50,
      maxRetries: 5,
      beforeConnect: () => {
        befores++
      },
      onconnect: () => {
        connects++
        if (connects === 2) {
          clearTimeout(timeout)
          resolve()
        }
      },
    })
      .then((s) => (testClient(s) as AMQPClient).socket?.destroy())
      .catch(reject)
  })
  await reconnected
  // Once before the initial connect, once before the reconnect.
  expect(befores).toBe(2)
})

test("a throwing beforeConnect on reconnect is retried, not fatal", async () => {
  let attempts = 0
  const reconnected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("did not recover within 5s")), 5_000)
    AMQPSession.connect("amqp://127.0.0.1", {
      reconnectInterval: 50,
      maxRetries: 10,
      beforeConnect: () => {
        attempts++
        // Fail the first reconnect attempt (attempt 2 overall); recover after.
        if (attempts === 2) throw new Error("authorization not ready")
      },
      onconnect: () => {
        if (attempts >= 3) {
          clearTimeout(timeout)
          resolve()
        }
      },
    })
      .then((s) => (testClient(s) as AMQPClient).socket?.destroy())
      .catch(reject)
  })
  await reconnected
  expect(attempts).toBeGreaterThanOrEqual(3)
})

test("manualAck: callback return does not ack — the caller acks on its own schedule", () =>
  withSession(async (session) => {
    const q = await session.queue("test-manualack-" + Math.random(), { durable: false, autoDelete: true })
    const received: string[] = []
    const held: AMQPMessage[] = []
    // prefetch: 1 means the broker won't deliver the second message until the
    // first is acked — only true when wire-level noAck is false, which proves
    // manualAck keeps the server tracking delivery tags.
    const sub = await q.subscribe({ manualAck: true, prefetch: 1 }, (msg) => {
      received.push(msg.bodyString() || "")
      held.push(msg)
    })

    await q.publish("m1", { confirm: false })
    await q.publish("m2", { confirm: false })
    await new Promise((resolve) => setTimeout(resolve, 200))
    // m2 is withheld: the callback returned for m1 but the library didn't ack.
    expect(received).toEqual(["m1"])

    await held[0]!.ack()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(received).toEqual(["m1", "m2"])

    await held[1]!.ack()
    await sub.cancel()
  }))

test("manualAck: an unacked message is redelivered after a reconnect", async () => {
  let connects = 0
  let resolveReconnected!: () => void
  const reconnected = new Promise<void>((resolve, reject) => {
    resolveReconnected = resolve
    setTimeout(() => reject(new Error("did not reconnect within 10s")), 10_000)
  })
  await withSession(
    async (session) => {
      const q = await session.queue("test-manualack-redeliver-" + Math.random(), {
        durable: true,
        autoDelete: false,
      })
      const received: string[] = []
      const sub = await q.subscribe({ manualAck: true, prefetch: 1 }, (msg) => {
        received.push(msg.bodyString() || "")
        // never ack — the broker must requeue and redeliver on reconnect
      })

      await q.publish("redeliver-me", { confirm: false })
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(received).toEqual(["redeliver-me"])
      ;(testClient(session) as AMQPClient).socket?.destroy()

      await reconnected
      await new Promise((resolve) => setTimeout(resolve, 200))
      // Delivered once before the drop, redelivered after recovery.
      expect(received.length).toBeGreaterThanOrEqual(2)
      expect(received.every((b) => b === "redeliver-me")).toBe(true)

      await sub.cancel()
      await q.delete()
    },
    {
      reconnectInterval: 50,
      maxRetries: 5,
      onconnect: () => {
        if (++connects === 2) resolveReconnected()
      },
    },
  )
})

test("onrecoverfailed fires when a tracked queue's consumer can't be recovered", async () => {
  const name = "test-recoverfail-" + Math.random()
  const recoverFailed = vi.fn()
  const failed = new Promise<void>((resolve, reject) => {
    setTimeout(() => reject(new Error("onrecoverfailed did not fire within 10s")), 10_000)
    recoverFailed.mockImplementation((queueName: string) => {
      if (queueName === name) resolve()
    })
  })
  await withSession(
    async (session) => {
      const q = await session.queue(name, { durable: true, autoDelete: false })
      await q.subscribe({ noAck: true }, () => {})

      // Delete the queue out from under the session. Recovery re-consumes only
      // (no redeclare), so basicConsume hits NOT_FOUND and reports the failure.
      const raw = await testClient(session).channel()
      await raw.queueDelete(name)
      await raw.close()
      ;(testClient(session) as AMQPClient).socket?.destroy()

      await failed
      expect(recoverFailed).toHaveBeenCalledWith(name, expect.any(Error))
    },
    { reconnectInterval: 50, maxRetries: 5, onrecoverfailed: recoverFailed },
  )
})

test("onblocked / onunblocked can be wired through options", async () => {
  // Triggering connection.blocked requires hitting a broker resource alarm,
  // which isn't safe to do in a shared test broker. Instead, verify the
  // session forwards the handlers onto the underlying client and simulate
  // the frame handler firing them.
  const onblocked = vi.fn()
  const onunblocked = vi.fn()
  const session = await AMQPSession.connect("amqp://127.0.0.1", { onblocked, onunblocked })
  try {
    const client = testClient(session)
    client.onblocked?.("low on memory")
    client.onunblocked?.()
    expect(onblocked).toHaveBeenCalledWith("low on memory")
    expect(onunblocked).toHaveBeenCalledTimes(1)
  } finally {
    await session.stop()
  }
})
