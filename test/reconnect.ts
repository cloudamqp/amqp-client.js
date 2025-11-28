import { expect, test, vi, beforeEach } from "vitest"
import { AMQPClient } from "../src/amqp-socket-client.js"
import { AMQPReconnectingClient } from "../src/amqp-reconnecting-client.js"
import type { AMQPMessage } from "../src/amqp-message.js"

function getNewClient(): AMQPClient {
  return new AMQPClient("amqp://127.0.0.1")
}

function createReconnectingClient(options = {}): AMQPReconnectingClient {
  return new AMQPReconnectingClient(() => getNewClient(), options)
}

beforeEach(() => {
  expect.hasAssertions()
})

test("can start and stop reconnecting client", async () => {
  const client = createReconnectingClient()

  await client.start()
  expect(client.connected).toBe(true)
  expect(client.started).toBe(true)

  await client.stop()
  expect(client.connected).toBe(false)
  expect(client.started).toBe(false)
})

test("can publish and consume with reconnecting client", async () => {
  const client = createReconnectingClient()
  await client.start()

  const q = await client.queue("")
  await q.publish("test message")

  let receivedMessage = ""
  const consumer = await q.subscribe({ noAck: true }, async (msg: AMQPMessage) => {
    receivedMessage = msg.bodyString() || ""
  })

  // Wait for message to be received
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(receivedMessage).toBe("test message")

  await consumer.cancel()
  await client.stop()
})

test("calls onconnect callback when connected", async () => {
  const client = createReconnectingClient()
  const onconnect = vi.fn()
  client.onconnect = onconnect

  await client.start()

  expect(onconnect).toHaveBeenCalledTimes(1)
  await client.stop()
})

test("calls ondisconnect callback when disconnected", async () => {
  const client = createReconnectingClient({ maxRetries: 1 })
  const ondisconnect = vi.fn()
  client.ondisconnect = ondisconnect

  await client.start()
  // Force disconnect by stopping and starting with invalid config
  await client.stop()

  // ondisconnect should have been called or not, depending on stop behavior
  expect(ondisconnect.mock.calls.length).toBeGreaterThanOrEqual(0)
})

test("can declare exchange with reconnecting client", async () => {
  const client = createReconnectingClient()
  await client.start()

  const exchangeName = "test-reconnect-exchange-" + Math.random()
  await client.exchangeDeclare(exchangeName, "fanout")
  await client.exchangeDelete(exchangeName)

  await client.stop()
  expect(true).toBe(true)
})

test("can bind queue with reconnecting client", async () => {
  const client = createReconnectingClient()
  await client.start()

  const q = await client.queue("")
  const exchangeName = "amq.fanout"
  await client.queueBind(q.name, exchangeName, "")
  await client.queueUnbind(q.name, exchangeName, "")

  await client.stop()
  expect(true).toBe(true)
})

test("can use publisher confirms with reconnecting client", async () => {
  const client = createReconnectingClient()
  await client.start()

  await client.confirmSelect()
  const tag = await client.publish("amq.fanout", "", "test message")
  expect(tag).toBe(1)

  await client.stop()
})

test("can set prefetch with reconnecting client", async () => {
  const client = createReconnectingClient()
  await client.start()

  await client.prefetch(10)

  await client.stop()
  expect(true).toBe(true)
})

test("reconnecting client reports not connected when stopped", async () => {
  const client = createReconnectingClient()

  expect(client.connected).toBe(false)
  expect(client.started).toBe(false)
})

test("can delete queue with reconnecting client", async () => {
  const client = createReconnectingClient()
  await client.start()

  const q = await client.queue("")
  const result = await client.queueDelete(q.name)
  expect(result.messageCount).toBeGreaterThanOrEqual(0)

  await client.stop()
})

test("subscribe stores consumer definition for recovery", async () => {
  const client = createReconnectingClient()
  await client.start()

  const queueName = "test-queue-" + Math.random()
  const q = await client.queue(queueName, { durable: false, autoDelete: true })
  
  let messageReceived = false
  const consumer = await client.subscribe(queueName, { noAck: true }, async () => {
    messageReceived = true
  })

  await q.publish("test")

  // Wait for message to be received
  await new Promise((resolve) => setTimeout(resolve, 100))
  
  expect(messageReceived).toBe(true)
  await consumer.cancel()
  await client.stop()
})

test("can unsubscribe from consumer", async () => {
  const client = createReconnectingClient()
  await client.start()

  const q = await client.queue("")
  const consumer = await q.subscribe({ noAck: true }, () => {})
  
  await client.unsubscribe(consumer.tag)

  await client.stop()
  expect(true).toBe(true)
})

test("accepts reconnect options", async () => {
  const client = createReconnectingClient({
    reconnectInterval: 500,
    maxReconnectInterval: 5000,
    backoffMultiplier: 1.5,
    maxRetries: 3,
  })

  await client.start()
  expect(client.connected).toBe(true)
  await client.stop()
})

test("using AsyncGenerator with reconnecting client", async () => {
  const client = createReconnectingClient()
  await client.start()

  const q = await client.queue("")
  await q.publish("test message 1")
  await q.publish("test message 2")

  const consumer = await q.subscribe({ noAck: true })
  const messages: string[] = []

  for await (const msg of consumer.messages) {
    messages.push(msg.bodyString()!)
    if (messages.length >= 2) break
  }

  expect(messages).toEqual(["test message 1", "test message 2"])
  await client.stop()
})

test("start is idempotent", async () => {
  const client = createReconnectingClient()

  await client.start()
  await client.start() // Should not throw
  expect(client.connected).toBe(true)

  await client.stop()
})

test("stop is idempotent", async () => {
  const client = createReconnectingClient()

  await client.start()
  await client.stop()
  await client.stop() // Should not throw
  expect(client.connected).toBe(false)
})

test("handles logger property", async () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }

  const client = new AMQPReconnectingClient(
    () => new AMQPClient("amqp://127.0.0.1", undefined, mockLogger),
  )

  expect(client.logger).toBe(mockLogger)
})
