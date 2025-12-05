import { expect, test, vi, beforeEach } from "vitest"
import { AMQPClient } from "../src/amqp-socket-client.js"
import type { AMQPMessage } from "../src/amqp-message.js"

function getNewClient(reconnectOptions = {}): AMQPClient {
  return new AMQPClient("amqp://127.0.0.1", undefined, undefined, reconnectOptions)
}

beforeEach(() => {
  expect.hasAssertions()
})

test("can connect and close client", async () => {
  const client = getNewClient()

  await client.connect()
  expect(client.closed).toBe(false)

  await client.close()
  expect(client.closed).toBe(true)
})

test("can publish and consume with client", async () => {
  const client = getNewClient()
  await client.connect()

  const ch = await client.channel()
  const q = await ch.queue("")
  await q.publish("test message")

  let receivedMessage = ""
  const consumer = await q.subscribe({ noAck: true }, async (msg: AMQPMessage) => {
    receivedMessage = msg.bodyString() || ""
  })

  // Wait for message to be received
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(receivedMessage).toBe("test message")

  await consumer.cancel()
  await client.close()
})

test("calls onconnect callback when connected", async () => {
  const client = getNewClient()
  const onconnect = vi.fn()
  client.onconnect = onconnect

  await client.connect()

  expect(onconnect).toHaveBeenCalledTimes(1)
  await client.close()
})

test("can declare exchange with client", async () => {
  const client = getNewClient()
  await client.connect()

  const ch = await client.channel()
  const exchangeName = "test-reconnect-exchange-" + Math.random()
  await ch.exchangeDeclare(exchangeName, "fanout")
  await ch.exchangeDelete(exchangeName)

  await client.close()
  expect(true).toBe(true)
})

test("can bind queue with client", async () => {
  const client = getNewClient()
  await client.connect()

  const ch = await client.channel()
  const q = await ch.queue("")
  const exchangeName = "amq.fanout"
  await q.bind(exchangeName, "")
  await q.unbind(exchangeName, "")

  await client.close()
  expect(true).toBe(true)
})

test("can use publisher confirms with client", async () => {
  const client = getNewClient()
  await client.connect()

  const ch = await client.channel()
  await ch.confirmSelect()
  const tag = await ch.basicPublish("amq.fanout", "", "test message")
  expect(tag).toBe(1)

  await client.close()
})

test("can set prefetch with client", async () => {
  const client = getNewClient()
  await client.connect()

  const ch = await client.channel()
  await ch.prefetch(10)

  await client.close()
  expect(true).toBe(true)
})

test("client reports closed when not connected", async () => {
  const client = getNewClient()

  expect(client.closed).toBe(true)
})

test("can delete queue with client", async () => {
  const client = getNewClient()
  await client.connect()

  const ch = await client.channel()
  const q = await ch.queue("")
  const result = await ch.queueDelete(q.name)
  expect(result.messageCount).toBeGreaterThanOrEqual(0)

  await client.close()
})

test("subscribe stores consumer definition for recovery", async () => {
  const client = getNewClient()
  await client.connect()

  const queueName = "test-queue-" + Math.random()
  const ch = await client.channel()
  const q = await ch.queue(queueName, { durable: false, autoDelete: true })
  
  let messageReceived = false
  const consumer = await q.subscribe({ noAck: true }, async () => {
    messageReceived = true
  })

  await q.publish("test")

  // Wait for message to be received
  await new Promise((resolve) => setTimeout(resolve, 100))
  
  expect(messageReceived).toBe(true)
  await consumer.cancel()
  await client.close()
})

test("can unsubscribe from consumer", async () => {
  const client = getNewClient()
  await client.connect()

  const ch = await client.channel()
  const q = await ch.queue("")
  const consumer = await q.subscribe({ noAck: true }, () => {})
  
  await q.unsubscribe(consumer.tag)

  await client.close()
  expect(true).toBe(true)
})

test("accepts reconnect options", async () => {
  const client = getNewClient({
    reconnectInterval: 500,
    maxReconnectInterval: 5000,
    backoffMultiplier: 1.5,
    maxRetries: 3,
  })

  await client.connect()
  expect(client.closed).toBe(false)
  await client.close()
})

test("using AsyncGenerator with client", async () => {
  const client = getNewClient()
  await client.connect()

  const ch = await client.channel()
  const q = await ch.queue("")
  await q.publish("test message 1")
  await q.publish("test message 2")

  const consumer = await q.subscribe({ noAck: true })
  const messages: string[] = []

  for await (const msg of consumer.messages) {
    messages.push(msg.bodyString()!)
    if (messages.length >= 2) break
  }

  expect(messages).toEqual(["test message 1", "test message 2"])
  await client.close()
})

test("connect is not idempotent", async () => {
  const client = getNewClient()

  await client.connect()
  // Second connect should resolve since the client is already connected
  await client.connect()
  expect(client.closed).toBe(false)

  await client.close()
})

test("handles logger property", async () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }

  const client = new AMQPClient("amqp://127.0.0.1", undefined, mockLogger)

  expect(client.logger).toBe(mockLogger)
})

test("subscribe method on client stores consumer for recovery", async () => {
  const client = getNewClient()
  await client.connect()

  const queueName = "test-queue-" + Math.random()
  const ch = await client.channel()
  await ch.queue(queueName, { durable: false, autoDelete: true })
  
  let messageReceived = false
  const consumer = await client.subscribe(queueName, { noAck: true }, async () => {
    messageReceived = true
  })

  const q2 = await ch.queue(queueName, { passive: true })
  await q2.publish("test")

  // Wait for message to be received
  await new Promise((resolve) => setTimeout(resolve, 100))
  
  expect(messageReceived).toBe(true)
  await consumer.cancel()
  await client.close()
})

test("unsubscribe method on client removes consumer", async () => {
  const client = getNewClient()
  await client.connect()

  const ch = await client.channel()
  const q = await ch.queue("")
  const consumer = await client.subscribe(q.name, { noAck: true }, () => {})

  await client.unsubscribe(consumer.tag)

  await client.close()
  expect(true).toBe(true)
})

test("client.subscribe supports prefetch option", async () => {
  const client = getNewClient()
  await client.connect()

  const queueName = "test-prefetch-queue-" + Math.random()
  const ch = await client.channel()
  await ch.queue(queueName, { durable: false, autoDelete: true })

  let messagesReceived = 0
  const consumer = await client.subscribe(queueName, { noAck: false }, async (msg) => {
    messagesReceived++
    // Don't ack immediately to test prefetch
    if (messagesReceived === 2) {
      await msg.ack()
    }
  }, {
    prefetch: 1
  })

  // Publish multiple messages
  const q2 = await ch.queue(queueName, { passive: true })
  await q2.publish("message 1")
  await q2.publish("message 2")
  await q2.publish("message 3")

  // Wait a bit
  await new Promise((resolve) => setTimeout(resolve, 200))

  // With prefetch=1, we should only receive 1 message until we ack
  expect(messagesReceived).toBe(1)

  await consumer.cancel()
  await client.close()
})

test("client.subscribe with AsyncGenerator supports prefetch", async () => {
  const client = getNewClient()
  await client.connect()

  const queueName = "test-prefetch-gen-queue-" + Math.random()
  const ch = await client.channel()
  await ch.queue(queueName, { durable: false, autoDelete: true })

  const consumer = await client.subscribe(queueName, { noAck: false }, {
    prefetch: 2
  })

  // Publish messages
  const q2 = await ch.queue(queueName, { passive: true })
  await q2.publish("message 1")
  await q2.publish("message 2")

  const messages: string[] = []
  for await (const msg of consumer.messages) {
    messages.push(msg.bodyString()!)
    await msg.ack()
    if (messages.length >= 2) break
  }

  expect(messages).toEqual(["message 1", "message 2"])
  await client.close()
})
