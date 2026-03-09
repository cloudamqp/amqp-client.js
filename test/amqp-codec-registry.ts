import { expect, test, describe, beforeEach } from "vitest"
import { AMQPCodecRegistry } from "../src/amqp-codec-registry.js"
import { AMQPMessage } from "../src/amqp-message.js"
import type { AMQPChannel } from "../src/amqp-channel.js"
import type { AMQPProperties } from "../src/amqp-properties.js"
import type { AMQPParser, AMQPCoder } from "../src/amqp-codec-registry.js"

beforeEach(() => {
  expect.hasAssertions()
})

describe("AMQPCodecRegistry", () => {
  describe("builtin JSON parser", () => {
    test("serialize and parse round-trips an object", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinParsers()
      const obj = { hello: "world", count: 42, nested: { ok: true } }

      const { body, properties } = await codecs.serializeAndEncode(obj, {
        contentType: "application/json",
      })

      expect(properties.contentType).toBe("application/json")
      expect(body).toBeInstanceOf(Uint8Array)

      const parsed = await codecs.decodeAndParse(body, properties)
      expect(parsed).toEqual(obj)
    })

    test("serialize and parse round-trips an array", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinParsers()
      const arr = [1, "two", null]

      const { body, properties } = await codecs.serializeAndEncode(arr, {
        contentType: "application/json",
      })
      const parsed = await codecs.decodeAndParse(body, properties)
      expect(parsed).toEqual(arr)
    })
  })

  describe("builtin text/plain parser", () => {
    test("serialize and parse round-trips a string", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinParsers()

      const { body, properties } = await codecs.serializeAndEncode("hello", {
        contentType: "text/plain",
      })
      const parsed = await codecs.decodeAndParse(body, properties)
      expect(parsed).toBe("hello")
    })

    test("serialize converts non-strings via String()", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinParsers()

      const { body } = await codecs.serializeAndEncode(42, {
        contentType: "text/plain",
      })
      expect(new TextDecoder().decode(body)).toBe("42")
    })
  })

  describe("builtin gzip coder", () => {
    test("encode and decode round-trips", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinCodecs()
      const original = "compress me please"

      const { body, properties } = await codecs.serializeAndEncode(original, {
        contentType: "text/plain",
        contentEncoding: "gzip",
      })

      expect(properties.contentEncoding).toBe("gzip")
      // Compressed body should differ from the plaintext
      expect(new TextDecoder().decode(body)).not.toBe(original)

      const parsed = await codecs.decodeAndParse(body, properties)
      expect(parsed).toBe(original)
    })
  })

  describe("builtin deflate coder", () => {
    test("encode and decode round-trips", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinCodecs()
      const original = { data: "deflate test" }

      const { body, properties } = await codecs.serializeAndEncode(original, {
        contentType: "application/json",
        contentEncoding: "deflate",
      })

      const parsed = await codecs.decodeAndParse(body, properties)
      expect(parsed).toEqual(original)
    })
  })

  describe("defaults", () => {
    test("applies default contentType when not set", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinParsers()

      const { body, properties } = await codecs.serializeAndEncode(
        { key: "value" },
        {},
        { contentType: "application/json" },
      )

      expect(properties.contentType).toBe("application/json")
      const parsed = await codecs.decodeAndParse(body, properties)
      expect(parsed).toEqual({ key: "value" })
    })

    test("explicit contentType overrides default", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinParsers()

      const { properties } = await codecs.serializeAndEncode(
        "hello",
        { contentType: "text/plain" },
        { contentType: "application/json" },
      )

      expect(properties.contentType).toBe("text/plain")
    })

    test("applies default contentEncoding when not set", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinCodecs()

      const { properties } = await codecs.serializeAndEncode(
        "test",
        { contentType: "text/plain" },
        { contentEncoding: "gzip" },
      )

      expect(properties.contentEncoding).toBe("gzip")
    })
  })

  describe("no-op passthrough", () => {
    test("unknown contentType passes body through as bytes", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinParsers()
      const raw = new TextEncoder().encode("raw bytes")

      const { body } = await codecs.serializeAndEncode(raw, {
        contentType: "application/octet-stream",
      })
      expect(body).toEqual(raw)
    })

    test("unknown contentEncoding passes body through", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinCodecs()
      const data = new TextEncoder().encode("not compressed")

      const result = await codecs.decodeAndParse(data, {
        contentEncoding: "br",
      })
      expect(result).toEqual(data)
    })

    test("no contentType or contentEncoding returns raw bytes", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinCodecs()
      const raw = new TextEncoder().encode("raw")

      const { body } = await codecs.serializeAndEncode(raw, {})
      const result = await codecs.decodeAndParse(body, {})
      expect(result).toEqual(raw)
    })
  })

  describe("custom codecs", () => {
    test("register and use a custom parser", async () => {
      const csvParser: AMQPParser = {
        serialize(body: unknown): Uint8Array {
          const rows = body as string[][]
          return new TextEncoder().encode(rows.map((r) => r.join(",")).join("\n"))
        },
        parse(body: Uint8Array): string[][] {
          const text = new TextDecoder().decode(body)
          return text.split("\n").map((line) => line.split(","))
        },
      }

      const codecs = new AMQPCodecRegistry()
      codecs.registerParser("text/csv", csvParser)

      const data = [
        ["a", "b"],
        ["1", "2"],
      ]
      const { body, properties } = await codecs.serializeAndEncode(data, {
        contentType: "text/csv",
      })

      const parsed = await codecs.decodeAndParse(body, properties)
      expect(parsed).toEqual(data)
    })

    test("register and use a custom coder", async () => {
      // A no-op "coder" that just reverses bytes (for testing)
      const reverseCoder: AMQPCoder = {
        async encode(body: Uint8Array): Promise<Uint8Array> {
          return new Uint8Array([...body].reverse())
        },
        async decode(body: Uint8Array): Promise<Uint8Array> {
          return new Uint8Array([...body].reverse())
        },
      }

      const codecs = new AMQPCodecRegistry().enableBuiltinParsers().registerCoder("reverse", reverseCoder)

      const { body, properties } = await codecs.serializeAndEncode("hello", {
        contentType: "text/plain",
        contentEncoding: "reverse",
      })

      const parsed = await codecs.decodeAndParse(body, properties)
      expect(parsed).toBe("hello")
    })
  })

  describe("full pipeline (serialize + compress + decompress + parse)", () => {
    test("JSON + gzip round-trip", async () => {
      const codecs = new AMQPCodecRegistry().enableBuiltinCodecs()
      const obj = { users: [{ name: "Alice" }, { name: "Bob" }] }

      const { body, properties } = await codecs.serializeAndEncode(obj, {
        contentType: "application/json",
        contentEncoding: "gzip",
      })

      expect(properties.contentType).toBe("application/json")
      expect(properties.contentEncoding).toBe("gzip")

      const parsed = await codecs.decodeAndParse(body, properties)
      expect(parsed).toEqual(obj)
    })
  })
})

describe("AMQPMessage.parse()", () => {
  function makeMessage(body: Uint8Array, props: AMQPProperties): AMQPMessage {
    const msg = new AMQPMessage({} as AMQPChannel)
    msg.body = body
    msg.properties = props
    return msg
  }

  test("parses JSON body when registry is attached", async () => {
    const codecs = new AMQPCodecRegistry().enableBuiltinParsers()
    const json = new TextEncoder().encode(JSON.stringify({ ok: true }))
    const msg = makeMessage(json, { contentType: "application/json" })
    msg.codecRegistry = codecs

    const result = await msg.parse()
    expect(result).toEqual({ ok: true })
  })

  test("accepts registry as argument", async () => {
    const codecs = new AMQPCodecRegistry().enableBuiltinParsers()
    const json = new TextEncoder().encode('"hello"')
    const msg = makeMessage(json, { contentType: "application/json" })

    const result = await msg.parse(codecs)
    expect(result).toBe("hello")
  })

  test("throws when no registry is available", async () => {
    const msg = makeMessage(new Uint8Array(0), {})
    await expect(msg.parse()).rejects.toThrow("No codec registry")
  })

  test("returns null for null body", async () => {
    const codecs = new AMQPCodecRegistry().enableBuiltinParsers()
    const msg = new AMQPMessage({} as AMQPChannel)
    msg.codecRegistry = codecs

    const result = await msg.parse()
    expect(result).toBeNull()
  })

  test("decodes gzip + JSON", async () => {
    const codecs = new AMQPCodecRegistry().enableBuiltinCodecs()
    const obj = { compressed: true }

    const { body, properties } = await codecs.serializeAndEncode(obj, {
      contentType: "application/json",
      contentEncoding: "gzip",
    })

    const msg = makeMessage(body, properties)
    msg.codecRegistry = codecs

    const result = await msg.parse()
    expect(result).toEqual(obj)
  })
})
