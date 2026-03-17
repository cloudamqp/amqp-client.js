/**
 * Compile-time type safety tests for the CodecMode generic system.
 *
 * These tests verify that TypeScript correctly narrows publish body types
 * based on whether a codec registry is configured. They run as vitest tests
 * but the real assertions are the @ts-expect-error comments — if the types
 * change in a way that breaks the contract, tsc will flag them.
 */
import { test, expectTypeOf } from "vitest"
import type { AMQPSession } from "../src/amqp-session.js"
import type { AMQPQueue } from "../src/amqp-queue.js"
import type { AMQPExchange } from "../src/amqp-exchange.js"
import type { AMQPRPCClient } from "../src/amqp-rpc-client.js"
import type { AMQPRPCServer, RPCHandler } from "../src/amqp-rpc-server.js"
import type { AMQPMessage } from "../src/amqp-message.js"
import type { Body, CodecMode, PlainBody } from "../src/amqp-publisher.js"

// --- Body<C> conditional type ---

test("Body<plain> is PlainBody", () => {
  expectTypeOf<Body<"plain">>().toEqualTypeOf<PlainBody>()
})

test("Body<codec> accepts objects, arrays, numbers, booleans", () => {
  type Codec = Body<"codec">
  expectTypeOf<{ key: string }>().toMatchTypeOf<Codec>()
  expectTypeOf<number>().toMatchTypeOf<Codec>()
  expectTypeOf<boolean>().toMatchTypeOf<Codec>()
  expectTypeOf<unknown[]>().toMatchTypeOf<Codec>()
  // PlainBody is still valid in codec mode
  expectTypeOf<string>().toMatchTypeOf<Codec>()
  expectTypeOf<null>().toMatchTypeOf<Codec>()
})

// --- Session generic propagation ---

test("AMQPSession defaults to plain mode", () => {
  expectTypeOf<AMQPSession>().toEqualTypeOf<AMQPSession<"plain">>()
})

test("plain session produces plain queues and exchanges", () => {
  type S = AMQPSession<"plain">
  expectTypeOf<Awaited<ReturnType<S["queue"]>>>().toEqualTypeOf<AMQPQueue<"plain">>()
  expectTypeOf<Awaited<ReturnType<S["fanoutExchange"]>>>().toEqualTypeOf<AMQPExchange<"plain">>()
  expectTypeOf<Awaited<ReturnType<S["directExchange"]>>>().toEqualTypeOf<AMQPExchange<"plain">>()
  expectTypeOf<Awaited<ReturnType<S["topicExchange"]>>>().toEqualTypeOf<AMQPExchange<"plain">>()
  expectTypeOf<Awaited<ReturnType<S["rpcClient"]>>>().toEqualTypeOf<AMQPRPCClient<"plain">>()
})

test("codec session produces codec queues and exchanges", () => {
  type S = AMQPSession<"codec">
  expectTypeOf<Awaited<ReturnType<S["queue"]>>>().toEqualTypeOf<AMQPQueue<"codec">>()
  expectTypeOf<Awaited<ReturnType<S["fanoutExchange"]>>>().toEqualTypeOf<AMQPExchange<"codec">>()
  expectTypeOf<Awaited<ReturnType<S["rpcClient"]>>>().toEqualTypeOf<AMQPRPCClient<"codec">>()
})

// --- Queue defaults ---

test("AMQPQueue defaults to plain mode", () => {
  expectTypeOf<AMQPQueue>().toEqualTypeOf<AMQPQueue<"plain">>()
})

// --- Exchange defaults ---

test("AMQPExchange defaults to plain mode", () => {
  expectTypeOf<AMQPExchange>().toEqualTypeOf<AMQPExchange<"plain">>()
})

// --- RPC defaults ---

test("AMQPRPCClient defaults to plain mode", () => {
  expectTypeOf<AMQPRPCClient>().toEqualTypeOf<AMQPRPCClient<"plain">>()
})

test("AMQPRPCServer defaults to plain mode", () => {
  expectTypeOf<AMQPRPCServer>().toEqualTypeOf<AMQPRPCServer<"plain">>()
})

// --- AMQPMessage is not generic ---

test("AMQPMessage.body is unknown (decoded or raw bytes)", () => {
  expectTypeOf<AMQPMessage["body"]>().toEqualTypeOf<unknown>()
})

test("AMQPMessage.rawBody is Uint8Array | null", () => {
  expectTypeOf<AMQPMessage["rawBody"]>().toEqualTypeOf<Uint8Array | null>()
})

// --- Plain queue rejects non-plain bodies at the type level ---

test("plain queue publish rejects objects", () => {
  type Q = AMQPQueue<"plain">
  type PublishBody = Parameters<Q["publish"]>[0]
  // Objects should not be assignable to PlainBody
  expectTypeOf<{ key: string }>().not.toMatchTypeOf<PublishBody>()
  expectTypeOf<number>().not.toMatchTypeOf<PublishBody>()
  expectTypeOf<boolean>().not.toMatchTypeOf<PublishBody>()
})

test("plain queue publish accepts plain body types", () => {
  type Q = AMQPQueue<"plain">
  type PublishBody = Parameters<Q["publish"]>[0]
  expectTypeOf<string>().toMatchTypeOf<PublishBody>()
  expectTypeOf<Uint8Array>().toMatchTypeOf<PublishBody>()
  expectTypeOf<null>().toMatchTypeOf<PublishBody>()
})

// --- Codec queue accepts rich bodies ---

test("codec queue publish accepts objects and primitives", () => {
  type Q = AMQPQueue<"codec">
  type PublishBody = Parameters<Q["publish"]>[0]
  expectTypeOf<{ key: string }>().toMatchTypeOf<PublishBody>()
  expectTypeOf<number>().toMatchTypeOf<PublishBody>()
  expectTypeOf<string>().toMatchTypeOf<PublishBody>()
})

// --- Exchange publish follows the same pattern ---

test("plain exchange publish rejects objects", () => {
  type X = AMQPExchange<"plain">
  type PublishBody = Parameters<X["publish"]>[0]
  expectTypeOf<{ key: string }>().not.toMatchTypeOf<PublishBody>()
})

test("codec exchange publish accepts objects", () => {
  type X = AMQPExchange<"codec">
  type PublishBody = Parameters<X["publish"]>[0]
  expectTypeOf<{ key: string }>().toMatchTypeOf<PublishBody>()
})

// --- RPCHandler follows CodecMode ---

test("RPCHandler<plain> must return PlainBody", () => {
  type HandlerReturn = ReturnType<RPCHandler<"plain">>
  expectTypeOf<string>().toMatchTypeOf<HandlerReturn>()
  expectTypeOf<Uint8Array>().toMatchTypeOf<HandlerReturn>()
  expectTypeOf<null>().toMatchTypeOf<HandlerReturn>()
  // Objects should not be valid return values in plain mode
  expectTypeOf<{ key: string }>().not.toMatchTypeOf<HandlerReturn>()
})

test("RPCHandler<codec> can return objects", () => {
  type HandlerReturn = ReturnType<RPCHandler<"codec">>
  expectTypeOf<{ key: string }>().toMatchTypeOf<HandlerReturn>()
  expectTypeOf<number>().toMatchTypeOf<HandlerReturn>()
})

test("RPCHandler defaults to plain mode", () => {
  expectTypeOf<RPCHandler>().toEqualTypeOf<RPCHandler<"plain">>()
})

// --- CodecMode is a string literal union ---

test("CodecMode is exactly 'plain' | 'codec'", () => {
  expectTypeOf<CodecMode>().toEqualTypeOf<"plain" | "codec">()
})
