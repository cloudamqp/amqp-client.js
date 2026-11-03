import { expect, test } from "vitest"
import { AMQPView } from "../src/amqp-view.js"
import type { Field } from "../src/amqp-properties.js"

function roundtrip(value: Field): { type: string; value: Field } {
  const view = new AMQPView(new ArrayBuffer(64))
  view.setTable(0, { k: value })
  const [table] = view.getTable(0)
  return { type: String.fromCharCode(view.getUint8(4 + 1 + 1)), value: table["k"] }
}

test.each([
  [-(2 ** 31), "I"],
  [2 ** 31 - 1, "I"],
  [2 ** 31, "l"],
  [-(2 ** 31) - 1, "l"],
  [2 ** 32 - 1, "l"],
  [-(2 ** 32) + 1, "l"],
  [Number.MIN_SAFE_INTEGER, "l"],
  [Number.MAX_SAFE_INTEGER, "l"],
])("encodes integer %d as type %s", (value, type) => {
  expect(roundtrip(value)).toEqual({ type, value })
})

test.each([2 ** 63, -(2 ** 64)])("throws for integer %d outside the 64-bit range", (value) => {
  expect(() => roundtrip(value)).toThrow(RangeError)
})

test.each([2n ** 63n, -(2n ** 63n) - 1n])("throws for bigint %d outside the 64-bit range", (value) => {
  expect(() => roundtrip(value)).toThrow(RangeError)
})
