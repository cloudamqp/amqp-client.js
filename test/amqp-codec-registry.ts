import { expect, test, describe, beforeEach } from "vitest"
import { builtinCoders, builtinParsers, serializeAndEncode, decodeAndParse } from "../src/amqp-codec-registry.js"
import type { AMQPParser, AMQPCoder, CoderMap, ParserMap } from "../src/amqp-codec-registry.js"

const noCoders: CoderMap = {}
const noParsers: ParserMap = {}

beforeEach(() => {
  expect.hasAssertions()
})

describe("builtin parsers and coders", () => {
  describe("builtin JSON parser", () => {
    test("serialize and parse round-trips an object", async () => {
      const obj = { hello: "world", count: 42, nested: { ok: true } }

      const { body, properties } = await serializeAndEncode(builtinParsers, noCoders, obj, {
        contentType: "application/json",
      })

      expect(properties.contentType).toBe("application/json")
      expect(body).toBeInstanceOf(Uint8Array)

      const parsed = await decodeAndParse(builtinParsers, noCoders, body, properties)
      expect(parsed).toEqual(obj)
    })

    test("serialize and parse round-trips an array", async () => {
      const arr = [1, "two", null]

      const { body, properties } = await serializeAndEncode(builtinParsers, noCoders, arr, {
        contentType: "application/json",
      })
      const parsed = await decodeAndParse(builtinParsers, noCoders, body, properties)
      expect(parsed).toEqual(arr)
    })
  })

  describe("builtin text/plain parser", () => {
    test("serialize and parse round-trips a string", async () => {
      const { body, properties } = await serializeAndEncode(builtinParsers, noCoders, "hello", {
        contentType: "text/plain",
      })
      const parsed = await decodeAndParse(builtinParsers, noCoders, body, properties)
      expect(parsed).toBe("hello")
    })

    test("serialize converts non-strings via String()", async () => {
      const { body } = await serializeAndEncode(builtinParsers, noCoders, 42, {
        contentType: "text/plain",
      })
      expect(new TextDecoder().decode(body)).toBe("42")
    })
  })

  describe("builtin gzip coder", () => {
    test("encode and decode round-trips", async () => {
      const original = "compress me please"

      const { body, properties } = await serializeAndEncode(builtinParsers, builtinCoders, original, {
        contentType: "text/plain",
        contentEncoding: "gzip",
      })

      expect(properties.contentEncoding).toBe("gzip")
      // Compressed body should differ from the raw bytes
      const uncompressed = new TextEncoder().encode(original)
      expect(body).not.toEqual(uncompressed)

      const parsed = await decodeAndParse(builtinParsers, builtinCoders, body, properties)
      expect(parsed).toBe(original)
    })
  })

  describe("builtin deflate coder", () => {
    test("encode and decode round-trips", async () => {
      const original = { data: "deflate test" }

      const { body, properties } = await serializeAndEncode(builtinParsers, builtinCoders, original, {
        contentType: "application/json",
        contentEncoding: "deflate",
      })

      const parsed = await decodeAndParse(builtinParsers, builtinCoders, body, properties)
      expect(parsed).toEqual(original)
    })
  })

  describe("defaults", () => {
    test("applies default contentType when not set", async () => {
      const { body, properties } = await serializeAndEncode(
        builtinParsers,
        noCoders,
        { key: "value" },
        {},
        { contentType: "application/json" },
      )

      expect(properties.contentType).toBe("application/json")
      const parsed = await decodeAndParse(builtinParsers, noCoders, body, properties)
      expect(parsed).toEqual({ key: "value" })
    })

    test("explicit contentType overrides default", async () => {
      const { properties } = await serializeAndEncode(
        builtinParsers,
        noCoders,
        "hello",
        { contentType: "text/plain" },
        { contentType: "application/json" },
      )

      expect(properties.contentType).toBe("text/plain")
    })

    test("applies default contentEncoding when not set", async () => {
      const { properties } = await serializeAndEncode(
        builtinParsers,
        builtinCoders,
        "test",
        { contentType: "text/plain" },
        { contentEncoding: "gzip" },
      )

      expect(properties.contentEncoding).toBe("gzip")
    })
  })

  describe("no-op passthrough", () => {
    test("unknown contentType passes body through as bytes", async () => {
      const raw = new TextEncoder().encode("raw bytes")

      const { body } = await serializeAndEncode(builtinParsers, noCoders, raw, {
        contentType: "application/octet-stream",
      })
      expect(body).toEqual(raw)
    })

    test("unknown contentEncoding throws on decode", async () => {
      const data = new TextEncoder().encode("not compressed")

      expect(() =>
        decodeAndParse(builtinParsers, builtinCoders, data, {
          contentEncoding: "br",
        }),
      ).toThrow(/No coder registered/)
    })

    test("no contentType or contentEncoding returns raw bytes", async () => {
      const raw = new TextEncoder().encode("raw")

      const { body } = await serializeAndEncode(builtinParsers, builtinCoders, raw, {})
      const result = decodeAndParse(builtinParsers, builtinCoders, body, {})
      expect(result).toEqual(raw)
    })

    test("throws for non-bytes body with unregistered contentType", () => {
      expect(() => serializeAndEncode(noParsers, noCoders, { foo: "bar" }, { contentType: "application/xml" })).toThrow(
        /No parser registered/,
      )
    })

    test("throws for unregistered contentEncoding on encode", () => {
      expect(() =>
        serializeAndEncode(builtinParsers, noCoders, "hello", { contentType: "text/plain", contentEncoding: "br" }),
      ).toThrow(/No coder registered/)
    })

    test("contentEncoding 'identity' is a no-op even with no coders", async () => {
      const { body, properties } = await serializeAndEncode(builtinParsers, noCoders, "hello", {
        contentType: "text/plain",
        contentEncoding: "identity",
      })
      expect(properties.contentEncoding).toBe("identity")
      expect(new TextDecoder().decode(body)).toBe("hello")

      const parsed = await decodeAndParse(builtinParsers, noCoders, body, properties)
      expect(parsed).toBe("hello")
    })

    test("contentEncoding 'identity' is case-insensitive", async () => {
      const { body, properties } = await serializeAndEncode(builtinParsers, noCoders, "hi", {
        contentType: "text/plain",
        contentEncoding: "Identity",
      })
      const parsed = await decodeAndParse(builtinParsers, noCoders, body, properties)
      expect(parsed).toBe("hi")
    })

    test("throws for non-bytes body without contentType", () => {
      expect(() => serializeAndEncode(noParsers, noCoders, { foo: "bar" }, {})).toThrow(/no contentType specified/)
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

      const parsers = { "text/csv": csvParser }

      const data = [
        ["a", "b"],
        ["1", "2"],
      ]
      const { body, properties } = await serializeAndEncode(parsers, noCoders, data, {
        contentType: "text/csv",
      })

      const parsed = await decodeAndParse(parsers, noCoders, body, properties)
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

      const coders = { reverse: reverseCoder }

      const { body, properties } = await serializeAndEncode(builtinParsers, coders, "hello", {
        contentType: "text/plain",
        contentEncoding: "reverse",
      })

      const parsed = await decodeAndParse(builtinParsers, coders, body, properties)
      expect(parsed).toBe("hello")
    })

    test("user parser overrides builtin when spread after builtins", async () => {
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

      const parsers = { ...builtinParsers, "application/json": customJsonParser }

      const obj = { hello: "world" }
      const { body, properties } = await serializeAndEncode(parsers, noCoders, obj, {
        contentType: "application/json",
      })

      // The raw bytes should contain the __custom marker, proving our override was used
      const raw = new TextDecoder().decode(body)
      expect(raw).toContain("__custom")

      const parsed = await decodeAndParse(parsers, noCoders, body, properties)
      expect(parsed).toEqual(obj)
    })
  })

  describe("full pipeline (serialize + compress + decompress + parse)", () => {
    test("JSON + gzip round-trip", async () => {
      const obj = { users: [{ name: "Alice" }, { name: "Bob" }] }

      const { body, properties } = await serializeAndEncode(builtinParsers, builtinCoders, obj, {
        contentType: "application/json",
        contentEncoding: "gzip",
      })

      expect(properties.contentType).toBe("application/json")
      expect(properties.contentEncoding).toBe("gzip")

      const parsed = await decodeAndParse(builtinParsers, builtinCoders, body, properties)
      expect(parsed).toEqual(obj)
    })
  })
})

describe("standalone functions", () => {
  test("serializeAndEncode: JSON round-trip", async () => {
    const obj = { hello: "world" }
    const result = await serializeAndEncode(builtinParsers, noCoders, obj, { contentType: "application/json" })
    expect(result.body).toBeInstanceOf(Uint8Array)
    const decoded = await decodeAndParse(builtinParsers, noCoders, result.body, result.properties)
    expect(decoded).toEqual(obj)
  })

  test("serializeAndEncode: sync fast path when no encoding", () => {
    const result = serializeAndEncode(builtinParsers, noCoders, "hello", { contentType: "text/plain" })
    expect(result).not.toBeInstanceOf(Promise)
  })

  test("serializeAndEncode: applies defaults", async () => {
    const result = await serializeAndEncode(builtinParsers, noCoders, "test", {}, { contentType: "text/plain" })
    expect(result.properties.contentType).toBe("text/plain")
  })

  test("decodeAndParse: missing coder throws", () => {
    const body = new TextEncoder().encode("test")
    expect(() => decodeAndParse(builtinParsers, noCoders, body, { contentEncoding: "brotli" })).toThrow(
      /No coder registered/,
    )
  })

  test("decodeAndParse: missing parser returns raw bytes", async () => {
    const body = new TextEncoder().encode("test")
    const result = await decodeAndParse(noParsers, noCoders, body, { contentType: "text/csv" })
    expect(result).toBeInstanceOf(Uint8Array)
  })

  test("decodeAndParse: sync fast path when no encoding", () => {
    const body = new TextEncoder().encode('"hello"')
    const result = decodeAndParse(builtinParsers, noCoders, body, { contentType: "application/json" })
    expect(result).not.toBeInstanceOf(Promise)
  })

  test("serializeAndEncode: throws for non-bytes body with unregistered contentType", () => {
    expect(() => serializeAndEncode(noParsers, noCoders, { foo: "bar" }, { contentType: "application/xml" })).toThrow(
      /No parser registered/,
    )
  })

  test("serializeAndEncode: throws for non-bytes body without contentType", () => {
    expect(() => serializeAndEncode(noParsers, noCoders, { foo: "bar" }, {})).toThrow(/no contentType specified/)
  })
})

describe("builtin registries", () => {
  test("builtinParsers has text/plain and application/json", () => {
    expect(builtinParsers["text/plain"]).toBeDefined()
    expect(builtinParsers["application/json"]).toBeDefined()
  })

  test("builtinCoders has gzip and deflate", () => {
    expect(builtinCoders["gzip"]).toBeDefined()
    expect(builtinCoders["deflate"]).toBeDefined()
  })

  test("custom parser map can be merged with builtinParsers via spread", () => {
    const identity: AMQPParser<Uint8Array, Uint8Array> = {
      serialize: (b) => b,
      parse: (b) => b,
    }
    const parsers = { ...builtinParsers, "application/octet-stream": identity }
    expect(parsers["application/octet-stream"]).toBe(identity)
    expect(parsers["application/json"]).toBeDefined()
  })
})
