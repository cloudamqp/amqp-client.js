/**
 * Compile-time type safety tests for the P/C/KP/KC generic system.
 *
 * These tests verify that TypeScript correctly narrows publish body types
 * based on parser/coder registries configured on a session. They run as
 * vitest tests but the real assertions are the expectTypeOf calls — if the
 * types change in a way that breaks the contract, tsc will flag them.
 */
import { test, expectTypeOf } from "vitest"
import type { AMQPSession } from "../src/amqp-session.js"
import type { AMQPQueue } from "../src/amqp-queue.js"
import type { AMQPExchange } from "../src/amqp-exchange.js"
import type { AMQPRPCClient } from "../src/amqp-rpc-client.js"
import type { AMQPRPCServer, RPCHandler } from "../src/amqp-rpc-server.js"
import type { AMQPMessage } from "../src/amqp-message.js"
import type { AMQPGeneratorSubscription } from "../src/amqp-subscription.js"
import type { PlainBody, ResolveBody, ResolveMessageBody } from "../src/amqp-publisher.js"
import type {
  AMQPParser,
  InferParserInput,
  InferParserOutput,
  CoderRegistry,
  AMQPCoder,
  JsonSerializable,
} from "../src/amqp-codec-registry.js"

type TestParsers = {
  "text/plain": AMQPParser<string, string>
  "application/json": AMQPParser<JsonSerializable, unknown>
}

// --- ResolveBody cascade ---

test("ResolveBody: explicit contentType application/json selects JsonSerializable", () => {
  expectTypeOf<ResolveBody<TestParsers, "application/json">>().toEqualTypeOf<JsonSerializable>()
})

test("ResolveBody: explicit contentType text/plain selects string", () => {
  expectTypeOf<ResolveBody<TestParsers, "text/plain">>().toEqualTypeOf<string>()
})

test("ResolveBody: never content type resolves to PlainBody", () => {
  expectTypeOf<ResolveBody<TestParsers, never>>().toEqualTypeOf<PlainBody>()
})

// --- ResolveMessageBody ---

test("ResolveMessageBody<{}> is Uint8Array | null", () => {
  expectTypeOf<ResolveMessageBody<{}>>().toEqualTypeOf<Uint8Array | null>()
})

test("ResolveMessageBody<TestParsers> is union of parser outputs plus Uint8Array | null", () => {
  expectTypeOf<ResolveMessageBody<TestParsers>>().toEqualTypeOf<unknown | string | Uint8Array | null>()
})

// --- AMQPParser<In, Out> ---

test("AMQPParser<In, Out> separates input and output types", () => {
  type P = AMQPParser<string, number>
  expectTypeOf<InferParserInput<P>>().toEqualTypeOf<string>()
  expectTypeOf<InferParserOutput<P>>().toEqualTypeOf<number>()
})

test("AMQPParser defaults both type params to unknown", () => {
  type P = AMQPParser
  expectTypeOf<InferParserInput<P>>().toEqualTypeOf<unknown>()
  expectTypeOf<InferParserOutput<P>>().toEqualTypeOf<unknown>()
})

// --- Bare generics produce plain (empty) defaults ---

test("AMQPSession defaults to AMQPSession<{}, {}, never, never>", () => {
  expectTypeOf<AMQPSession>().toEqualTypeOf<AMQPSession<{}, {}, never, never>>()
})

test("AMQPQueue defaults to AMQPQueue<{}, {}, never, never>", () => {
  expectTypeOf<AMQPQueue>().toEqualTypeOf<AMQPQueue<{}, {}, never, never>>()
})

test("AMQPExchange defaults to AMQPExchange<{}, {}, never, never>", () => {
  expectTypeOf<AMQPExchange>().toEqualTypeOf<AMQPExchange<{}, {}, never, never>>()
})

test("AMQPRPCClient defaults to AMQPRPCClient<{}, {}, never, never>", () => {
  expectTypeOf<AMQPRPCClient>().toEqualTypeOf<AMQPRPCClient<{}, {}, never, never>>()
})

test("AMQPRPCServer defaults to AMQPRPCServer<{}, {}, never, never>", () => {
  expectTypeOf<AMQPRPCServer>().toEqualTypeOf<AMQPRPCServer<{}, {}, never, never>>()
})

test("AMQPMessage defaults to AMQPMessage<{}>", () => {
  expectTypeOf<AMQPMessage>().toEqualTypeOf<AMQPMessage<{}>>()
})

test("RPCHandler defaults to RPCHandler<{}, never>", () => {
  expectTypeOf<RPCHandler>().toEqualTypeOf<RPCHandler<{}, never>>()
})

test("AMQPGeneratorSubscription defaults to AMQPGeneratorSubscription<{}>", () => {
  expectTypeOf<AMQPGeneratorSubscription>().toEqualTypeOf<AMQPGeneratorSubscription<{}>>()
})

// --- AMQPMessage body types ---

test("AMQPMessage<{}>.body is Uint8Array | null", () => {
  expectTypeOf<AMQPMessage<{}>["body"]>().toEqualTypeOf<Uint8Array | null>()
})

test("AMQPMessage<TestParsers>.body is union of parser outputs plus Uint8Array | null", () => {
  expectTypeOf<AMQPMessage<TestParsers>["body"]>().toEqualTypeOf<unknown | string | Uint8Array | null>()
})

// --- AMQPMessage._rawBytes is always Uint8Array | null ---

test("AMQPMessage<{}>._rawBytes is Uint8Array | null", () => {
  expectTypeOf<AMQPMessage<{}>["_rawBytes"]>().toEqualTypeOf<Uint8Array | null>()
})

test("AMQPMessage<TestParsers>._rawBytes is Uint8Array | null", () => {
  expectTypeOf<AMQPMessage<TestParsers>["_rawBytes"]>().toEqualTypeOf<Uint8Array | null>()
})

// --- Queue publish body types ---
// publish<O extends keyof P & string = KP>(body: ResolveBody<P, O>, ...)
// Extract body type by fixing O to KP via ResolveBody directly.

test("plain queue publish body is PlainBody", () => {
  // AMQPQueue<{}> has P = {}, KP = never → ResolveBody<{}, never> = PlainBody
  expectTypeOf<ResolveBody<{}, never>>().toEqualTypeOf<PlainBody>()
})

test("queue with parsers and default contentType constrains body to default parser input", () => {
  // AMQPQueue<TestParsers, {}, "text/plain"> has KP = "text/plain"
  // → ResolveBody<TestParsers, "text/plain"> = string
  expectTypeOf<ResolveBody<TestParsers, "text/plain">>().toEqualTypeOf<string>()
})

test("queue with parsers but no default contentType falls back to PlainBody", () => {
  // AMQPQueue<TestParsers, {}, never> has KP = never → ResolveBody<TestParsers, never> = PlainBody
  expectTypeOf<ResolveBody<TestParsers, never>>().toEqualTypeOf<PlainBody>()
})

// --- Plain queue rejects non-plain body types ---

test("plain queue publish rejects objects and numbers", () => {
  // PlainBody = string | Uint8Array | ArrayBuffer | Buffer | null
  expectTypeOf<{ key: string }>().not.toMatchTypeOf<PlainBody>()
  expectTypeOf<number>().not.toMatchTypeOf<PlainBody>()
})

// --- Exchange publish follows same pattern ---

test("plain exchange publish body is PlainBody", () => {
  // AMQPExchange<{}> has P = {}, KP = never → ResolveBody<{}, never> = PlainBody
  expectTypeOf<ResolveBody<{}, never>>().toEqualTypeOf<PlainBody>()
})

test("plain exchange publish rejects objects", () => {
  expectTypeOf<{ key: string }>().not.toMatchTypeOf<PlainBody>()
})

test("exchange with parsers and default contentType constrains body", () => {
  // AMQPExchange<TestParsers, {}, "text/plain"> → ResolveBody<TestParsers, "text/plain"> = string
  expectTypeOf<ResolveBody<TestParsers, "text/plain">>().toEqualTypeOf<string>()
})

// --- RPCHandler types ---

test("RPCHandler<{}, never> return type is PlainBody", () => {
  type HandlerReturn = ReturnType<RPCHandler<{}, never>>
  expectTypeOf<HandlerReturn>().toEqualTypeOf<PlainBody | Promise<PlainBody>>()
})

test("RPCHandler<TestParsers, 'application/json'> return type is JsonSerializable", () => {
  type HandlerReturn = ReturnType<RPCHandler<TestParsers, "application/json">>
  expectTypeOf<HandlerReturn>().toEqualTypeOf<JsonSerializable | Promise<JsonSerializable>>()
})

test("RPCHandler<{}> receives AMQPMessage<{}>", () => {
  type Param = Parameters<RPCHandler<{}>>[0]
  expectTypeOf<Param>().toEqualTypeOf<AMQPMessage<{}>>()
})

test("RPCHandler<TestParsers> receives AMQPMessage<TestParsers>", () => {
  type Param = Parameters<RPCHandler<TestParsers>>[0]
  expectTypeOf<Param>().toEqualTypeOf<AMQPMessage<TestParsers>>()
})

// --- Subscribe yields typed messages ---

test("AMQPGeneratorSubscription<{}> yields AMQPMessage<{}>", () => {
  type Sub = AMQPGeneratorSubscription<{}>
  type Yielded = Sub extends AsyncIterable<infer T> ? T : never
  expectTypeOf<Yielded>().toEqualTypeOf<AMQPMessage<{}>>()
})

test("AMQPGeneratorSubscription<TestParsers> yields AMQPMessage<TestParsers>", () => {
  type Sub = AMQPGeneratorSubscription<TestParsers>
  type Yielded = Sub extends AsyncIterable<infer T> ? T : never
  expectTypeOf<Yielded>().toEqualTypeOf<AMQPMessage<TestParsers>>()
})

// --- Session propagation ---

test("AMQPSession<{}> queue returns AMQPQueue<{}, {}, never, never>", () => {
  type S = AMQPSession<{}>
  type Q = Awaited<ReturnType<S["queue"]>>
  expectTypeOf<Q>().toEqualTypeOf<AMQPQueue<{}, {}, never, never>>()
})

test("AMQPSession<{}> exchange returns AMQPExchange<{}, {}, never, never>", () => {
  type S = AMQPSession<{}>
  type X = Awaited<ReturnType<S["fanoutExchange"]>>
  expectTypeOf<X>().toEqualTypeOf<AMQPExchange<{}, {}, never, never>>()
})

test("AMQPSession<{}> rpcClient returns AMQPRPCClient<{}, {}, never, never>", () => {
  type S = AMQPSession<{}>
  type R = Awaited<ReturnType<S["rpcClient"]>>
  expectTypeOf<R>().toEqualTypeOf<AMQPRPCClient<{}, {}, never, never>>()
})

// --- CoderRegistry preserves keys ---

test("CoderRegistry preserves keys in type", () => {
  type R = CoderRegistry<{ custom: AMQPCoder } & { gzip: AMQPCoder }>
  expectTypeOf<R["gzip"]>().toEqualTypeOf<AMQPCoder>()
  expectTypeOf<R["custom"]>().toEqualTypeOf<AMQPCoder>()
})
