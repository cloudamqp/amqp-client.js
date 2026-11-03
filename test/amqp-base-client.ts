import { expect, test, describe } from "vitest"
import { negotiateMax } from "../src/amqp-base-client.js"

describe("negotiateMax (connection.tune channelMax/frameMax negotiation)", () => {
  test("both nonzero: takes the smaller of the two", () => {
    expect(negotiateMax(8192, 131072)).toBe(8192)
    expect(negotiateMax(131072, 8192)).toBe(8192)
  })

  test("client wants no limit (0), broker sets a limit: broker's limit wins", () => {
    expect(negotiateMax(0, 2048)).toBe(2048)
  })

  test("broker has no limit (0), client sets a limit: client's limit wins", () => {
    // Regression: Math.min(8192, 0) used to collapse this to 0 ("unlimited"),
    // silently discarding the client's requested cap.
    expect(negotiateMax(8192, 0)).toBe(8192)
  })

  test("both sides have no limit (0): stays unlimited", () => {
    expect(negotiateMax(0, 0)).toBe(0)
  })
})
