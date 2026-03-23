import { expect, test, describe, beforeEach } from "vitest"
import {
  createCoderRegistry,
  createParserRegistry,
  serializeAndEncode,
  decodeAndParse,
} from "../src/amqp-codec-registry.js"
import type { AMQPParser, AMQPCoder } from "../src/amqp-codec-registry.js"

beforeEach(() => {
  expect.hasAssertions()
})

describe("builtin parsers and coders", () => {
  describe("builtin JSON parser", () => {
    test("serialize and parse round-trips an object", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({})
      const obj = { hello: "world", count: 42, nested: { ok: true } }

      const { body, properties } = await serializeAndEncode(parsers, coders, obj, {
        contentType: "application/json",
      })

      expect(properties.contentType).toBe("application/json")
      expect(body).toBeInstanceOf(Uint8Array)

      const parsed = await decodeAndParse(parsers, coders, body, properties)
      expect(parsed).toEqual(obj)
    })

    test("serialize and parse round-trips an array", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({})
      const arr = [1, "two", null]

      const { body, properties } = await serializeAndEncode(parsers, coders, arr, {
        contentType: "application/json",
      })
      const parsed = await decodeAndParse(parsers, coders, body, properties)
      expect(parsed).toEqual(arr)
    })
  })

  describe("builtin text/plain parser", () => {
    test("serialize and parse round-trips a string", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({})

      const { body, properties } = await serializeAndEncode(parsers, coders, "hello", {
        contentType: "text/plain",
      })
      const parsed = await decodeAndParse(parsers, coders, body, properties)
      expect(parsed).toBe("hello")
    })

    test("serialize converts non-strings via String()", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({})

      const { body } = await serializeAndEncode(parsers, coders, 42, {
        contentType: "text/plain",
      })
      expect(new TextDecoder().decode(body)).toBe("42")
    })
  })

  describe("builtin gzip coder", () => {
    test("encode and decode round-trips", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({}, true)
      const original = "compress me please"

      const { body, properties } = await serializeAndEncode(parsers, coders, original, {
        contentType: "text/plain",
        contentEncoding: "gzip",
      })

      expect(properties.contentEncoding).toBe("gzip")
      // Compressed body should differ from the raw bytes
      const uncompressed = new TextEncoder().encode(original)
      expect(body).not.toEqual(uncompressed)

      const parsed = await decodeAndParse(parsers, coders, body, properties)
      expect(parsed).toBe(original)
    })
  })

  describe("builtin deflate coder", () => {
    test("encode and decode round-trips", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({}, true)
      const original = { data: "deflate test" }

      const { body, properties } = await serializeAndEncode(parsers, coders, original, {
        contentType: "application/json",
        contentEncoding: "deflate",
      })

      const parsed = await decodeAndParse(parsers, coders, body, properties)
      expect(parsed).toEqual(original)
    })
  })

  describe("defaults", () => {
    test("applies default contentType when not set", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({})

      const { body, properties } = await serializeAndEncode(
        parsers,
        coders,
        { key: "value" },
        {},
        { contentType: "application/json" },
      )

      expect(properties.contentType).toBe("application/json")
      const parsed = await decodeAndParse(parsers, coders, body, properties)
      expect(parsed).toEqual({ key: "value" })
    })

    test("explicit contentType overrides default", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({})

      const { properties } = await serializeAndEncode(
        parsers,
        coders,
        "hello",
        { contentType: "text/plain" },
        { contentType: "application/json" },
      )

      expect(properties.contentType).toBe("text/plain")
    })

    test("applies default contentEncoding when not set", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({}, true)

      const { properties } = await serializeAndEncode(
        parsers,
        coders,
        "test",
        { contentType: "text/plain" },
        { contentEncoding: "gzip" },
      )

      expect(properties.contentEncoding).toBe("gzip")
    })
  })

  describe("no-op passthrough", () => {
    test("unknown contentType passes body through as bytes", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({})
      const raw = new TextEncoder().encode("raw bytes")

      const { body } = await serializeAndEncode(parsers, coders, raw, {
        contentType: "application/octet-stream",
      })
      expect(body).toEqual(raw)
    })

    test("unknown contentEncoding throws on decode", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({}, true)
      const data = new TextEncoder().encode("not compressed")

      expect(() =>
        decodeAndParse(parsers, coders, data, {
          contentEncoding: "br",
        }),
      ).toThrow(/No coder registered/)
    })

    test("no contentType or contentEncoding returns raw bytes", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({}, true)
      const raw = new TextEncoder().encode("raw")

      const { body } = await serializeAndEncode(parsers, coders, raw, {})
      const result = decodeAndParse(parsers, coders, body, {})
      expect(result).toEqual(raw)
    })

    test("throws for non-bytes body with unregistered contentType", () => {
      const parsers = createParserRegistry({})
      const coders = createCoderRegistry({})

      expect(() => serializeAndEncode(parsers, coders, { foo: "bar" }, { contentType: "application/xml" })).toThrow(
        /No parser registered/,
      )
    })

    test("throws for unregistered contentEncoding on encode", () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({})

      expect(() =>
        serializeAndEncode(parsers, coders, "hello", { contentType: "text/plain", contentEncoding: "br" }),
      ).toThrow(/No coder registered/)
    })

    test("throws for non-bytes body without contentType", () => {
      const parsers = createParserRegistry({})
      const coders = createCoderRegistry({})

      expect(() => serializeAndEncode(parsers, coders, { foo: "bar" }, {})).toThrow(/no contentType specified/)
    })
  })

  describe("custom codecs", () => {
    test("register and use a custom parser", async () => {
      const csvParser: AMQPParser<string[][]> = {
        serialize(body: string[][]): Uint8Array {
          return new TextEncoder().encode(body.map((r) => r.join(",")).join("\n"))
        },
        parse(body: Uint8Array): string[][] {
          const text = new TextDecoder().decode(body)
          return text.split("\n").map((line) => line.split(","))
        },
      }

      const parsers = createParserRegistry({ "text/csv": csvParser })
      const coders = createCoderRegistry({})

      const data = [
        ["a", "b"],
        ["1", "2"],
      ]
      const { body, properties } = await serializeAndEncode(parsers, coders, data, {
        contentType: "text/csv",
      })

      const parsed = await decodeAndParse(parsers, coders, body, properties)
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

      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({ reverse: reverseCoder })

      const { body, properties } = await serializeAndEncode(parsers, coders, "hello", {
        contentType: "text/plain",
        contentEncoding: "reverse",
      })

      const parsed = await decodeAndParse(parsers, coders, body, properties)
      expect(parsed).toBe("hello")
    })

    test("user parser overrides builtin when useDefaults is true", async () => {
      // Custom JSON parser that wraps values in a marker object
      const customJsonParser: AMQPParser<unknown, unknown> = {
        serialize(body: unknown): Uint8Array {
          return new TextEncoder().encode(JSON.stringify({ __custom: true, value: body }))
        },
        parse(body: Uint8Array): unknown {
          const parsed = JSON.parse(new TextDecoder().decode(body)) as { __custom: boolean; value: unknown }
          return parsed.value
        },
      }

      const parsers = createParserRegistry({ "application/json": customJsonParser }, true)
      const coders = createCoderRegistry({})

      const obj = { hello: "world" }
      const { body, properties } = await serializeAndEncode(parsers, coders, obj, {
        contentType: "application/json",
      })

      // The raw bytes should contain the __custom marker, proving our override was used
      const raw = new TextDecoder().decode(body)
      expect(raw).toContain("__custom")

      const parsed = await decodeAndParse(parsers, coders, body, properties)
      expect(parsed).toEqual(obj)
    })
  })

  describe("full pipeline (serialize + compress + decompress + parse)", () => {
    test("JSON + gzip round-trip", async () => {
      const parsers = createParserRegistry({}, true)
      const coders = createCoderRegistry({}, true)
      const obj = { users: [{ name: "Alice" }, { name: "Bob" }] }

      const { body, properties } = await serializeAndEncode(parsers, coders, obj, {
        contentType: "application/json",
        contentEncoding: "gzip",
      })

      expect(properties.contentType).toBe("application/json")
      expect(properties.contentEncoding).toBe("gzip")

      const parsed = await decodeAndParse(parsers, coders, body, properties)
      expect(parsed).toEqual(obj)
    })
  })
})

describe("standalone functions", () => {
  test("serializeAndEncode: JSON round-trip", async () => {
    const parsers = createParserRegistry({}, true)
    const coders = createCoderRegistry({})
    const obj = { hello: "world" }
    const result = await serializeAndEncode(parsers, coders, obj, { contentType: "application/json" })
    expect(result.body).toBeInstanceOf(Uint8Array)
    const decoded = await decodeAndParse(parsers, coders, result.body, result.properties)
    expect(decoded).toEqual(obj)
  })

  test("serializeAndEncode: sync fast path when no encoding", () => {
    const parsers = createParserRegistry({}, true)
    const coders = createCoderRegistry({})
    const result = serializeAndEncode(parsers, coders, "hello", { contentType: "text/plain" })
    expect(result).not.toBeInstanceOf(Promise)
  })

  test("serializeAndEncode: applies defaults", async () => {
    const parsers = createParserRegistry({}, true)
    const coders = createCoderRegistry({})
    const result = await serializeAndEncode(parsers, coders, "test", {}, { contentType: "text/plain" })
    expect(result.properties.contentType).toBe("text/plain")
  })

  test("decodeAndParse: missing coder throws", () => {
    const parsers = createParserRegistry({}, true)
    const coders = createCoderRegistry({})
    const body = new TextEncoder().encode("test")
    expect(() => decodeAndParse(parsers, coders, body, { contentEncoding: "brotli" })).toThrow(/No coder registered/)
  })

  test("decodeAndParse: missing parser returns raw bytes", async () => {
    const parsers = createParserRegistry({})
    const coders = createCoderRegistry({})
    const body = new TextEncoder().encode("test")
    const result = await decodeAndParse(parsers, coders, body, { contentType: "text/csv" })
    expect(result).toBeInstanceOf(Uint8Array)
  })

  test("decodeAndParse: sync fast path when no encoding", () => {
    const parsers = createParserRegistry({}, true)
    const coders = createCoderRegistry({})
    const body = new TextEncoder().encode('"hello"')
    const result = decodeAndParse(parsers, coders, body, { contentType: "application/json" })
    expect(result).not.toBeInstanceOf(Promise)
  })

  test("serializeAndEncode: throws for non-bytes body with unregistered contentType", () => {
    const parsers = createParserRegistry({})
    const coders = createCoderRegistry({})
    expect(() => serializeAndEncode(parsers, coders, { foo: "bar" }, { contentType: "application/xml" })).toThrow(
      /No parser registered/,
    )
  })

  test("serializeAndEncode: throws for non-bytes body without contentType", () => {
    const parsers = createParserRegistry({})
    const coders = createCoderRegistry({})
    expect(() => serializeAndEncode(parsers, coders, { foo: "bar" }, {})).toThrow(/no contentType specified/)
  })
})

describe("createCoderRegistry", () => {
  test("returns registry with custom coders", () => {
    const identity: AMQPCoder = {
      encode: async (b) => b,
      decode: async (b) => b,
    }
    const coders = createCoderRegistry({ identity: identity })
    expect(coders["identity"]).toBe(identity)
  })

  test("with useDefaults includes gzip and deflate", () => {
    const coders = createCoderRegistry({}, true)
    expect(coders["gzip"]).toBeDefined()
    expect(coders["deflate"]).toBeDefined()
  })
})
