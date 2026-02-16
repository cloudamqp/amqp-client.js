import { expect, test, beforeEach, describe } from "vitest"
import { AMQPClient } from "../src/amqp-socket-client.js"
import { compressionRegistry, CompressionError } from "../src/amqp-compression.js"

function getNewClient(): AMQPClient {
  return new AMQPClient("amqp://127.0.0.1")
}

beforeEach(() => {
  expect.hasAssertions()
})

describe("Compression", () => {
  describe("basicPublish with compression", () => {
    test("can publish with gzip compression", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")
      const body = "Hello World".repeat(100)

      await ch.basicPublish("", q.name, body, {}, false, false, { compression: "gzip" })

      const msg = await ch.basicGet(q.name)
      expect(msg).toBeTruthy()
      expect(msg?.properties.contentEncoding).toBe("gzip")

      // Raw body should be compressed (smaller)
      expect(msg?.body?.byteLength).toBeLessThan(body.length)

      // Decompressed body should match original
      const decompressed = msg?.bodyToString()
      expect(decompressed).toBe(body)

      await conn.close()
    })

    test("respects compressionThreshold - no compression for small body", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")
      const smallBody = "small"

      await ch.basicPublish("", q.name, smallBody, {}, false, false, {
        compression: "gzip",
        compressionThreshold: 1000,
      })

      const msg = await ch.basicGet(q.name)
      expect(msg?.properties.contentEncoding).toBeUndefined()
      expect(msg?.bodyString()).toBe(smallBody)

      await conn.close()
    })

    test("compresses when body exceeds threshold", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")
      const largeBody = "large body content".repeat(100)

      await ch.basicPublish("", q.name, largeBody, {}, false, false, {
        compression: "gzip",
        compressionThreshold: 100,
      })

      const msg = await ch.basicGet(q.name)
      expect(msg?.properties.contentEncoding).toBe("gzip")
      expect(msg?.bodyToString()).toBe(largeBody)

      await conn.close()
    })

    test("works without options", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")

      await ch.basicPublish("", q.name, "test", {}, false, false)

      const msg = await ch.basicGet(q.name)
      expect(msg?.bodyString()).toBe("test")

      await conn.close()
    })
  })

  describe("AMQPQueue.publish with compression", () => {
    test("can publish with compression via queue", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")
      const body = "Queue publish test".repeat(50)

      await q.publish(body, {}, { compression: "gzip" })

      const msg = await ch.basicGet(q.name)
      expect(msg?.properties.contentEncoding).toBe("gzip")
      expect(msg?.bodyToString()).toBe(body)

      await conn.close()
    })
  })

  describe("AMQPMessage decompression", () => {
    test("auto-decompresses gzip messages", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")
      const body = "Test message for decompression"

      await ch.basicPublish("", q.name, body, {}, false, false, { compression: "gzip" })

      const msg = await ch.basicGet(q.name)
      expect(msg?.bodyToString()).toBe(body)

      await conn.close()
    })

    test("bodyDecompressed returns raw body for non-compressed messages", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")
      const body = "Non-compressed message"

      await ch.basicPublish("", q.name, body, {})

      const msg = await ch.basicGet(q.name)
      const decompressed = msg?.bodyDecompressed()
      expect(decompressed).toEqual(msg?.body)

      await conn.close()
    })

    test("caches decompressed body", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")
      const body = "Test message"

      await ch.basicPublish("", q.name, body, {}, false, false, { compression: "gzip" })

      const msg = await ch.basicGet(q.name)
      const first = msg?.bodyDecompressed()
      const second = msg?.bodyDecompressed()

      // Should be the exact same reference (cached)
      expect(first).toBe(second)

      await conn.close()
    })

    test("sync bodyString still works for non-compressed messages", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")

      await ch.basicPublish("", q.name, "test", {})

      const msg = await ch.basicGet(q.name)
      // Sync method should still work for non-compressed messages
      expect(msg?.bodyString()).toBe("test")

      await conn.close()
    })

    test("passes through unknown contentEncoding", async () => {
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")
      const body = "Test with unknown encoding"

      // Publish with a custom contentEncoding that's not compression
      await ch.basicPublish("", q.name, body, { contentEncoding: "utf-8" })

      const msg = await ch.basicGet(q.name)
      // Should return raw body since 'utf-8' is not a known compression encoding
      const decompressed = msg?.bodyDecompressed()
      expect(decompressed).toEqual(msg?.body)

      await conn.close()
    })
  })

  describe("codec registry", () => {
    test("gzip codec is available (built-in)", async () => {
      const gzipCodec = await compressionRegistry.getCodec("gzip")
      expect(gzipCodec).toBeTruthy()
      expect(gzipCodec?.contentEncoding).toBe("gzip")
    })

    test("can register custom codec", async () => {
      const customCodec = {
        contentEncoding: "custom-test",
        compress: (data: Uint8Array) => data,
        decompress: (data: Uint8Array) => data,
      }

      compressionRegistry.registerCodec("custom-test", customCodec)

      // Can use the custom codec
      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")

      // Manually set contentEncoding to our custom codec
      await ch.basicPublish("", q.name, "test", { contentEncoding: "custom-test" })

      const msg = await ch.basicGet(q.name)
      expect(msg?.properties.contentEncoding).toBe("custom-test")

      await conn.close()
    })
  })

  // Test each compression algorithm if available
  describe.each(["gzip", "lz4", "snappy", "zstd"] as const)("%s compression", (algorithm) => {
    test(`round-trip with ${algorithm}`, async () => {
      const codec = await compressionRegistry.getCodec(algorithm)
      if (!codec) {
        console.log(`Skipping ${algorithm} test - codec not available`)
        expect(true).toBe(true) // Ensure at least one assertion
        return
      }

      const amqp = getNewClient()
      const conn = await amqp.connect()
      const ch = await conn.channel()
      const q = await ch.queue("")
      const body = JSON.stringify({ test: "data", array: [1, 2, 3] })

      await ch.basicPublish("", q.name, body, { contentType: "application/json" }, false, false, {
        compression: algorithm,
      })

      const msg = await ch.basicGet(q.name)
      expect(msg?.properties.contentEncoding).toBe(algorithm)
      expect(msg?.bodyToString()).toBe(body)

      await conn.close()
    })
  })
})

describe("CompressionError", () => {
  test("has correct name and properties", () => {
    const error = new CompressionError("Test error", "gzip")
    expect(error.name).toBe("CompressionError")
    expect(error.message).toBe("Test error")
    expect(error.algorithm).toBe("gzip")
    expect(error instanceof Error).toBe(true)
  })
})
