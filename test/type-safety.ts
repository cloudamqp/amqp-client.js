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
import type { AMQPMessage, MessageBody } from "../src/amqp-message.js"
import type { AMQPGeneratorSubscription } from "../src/amqp-subscription.js"
import type { Body, CodecMode, PlainBody, ResolveBody } from "../src/amqp-publisher.js"
import type { AMQPParser } from "../src/amqp-codec-registry.js"

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

// --- AMQPMessage generic ---

test("AMQPMessage defaults to plain mode", () => {
  expectTypeOf<AMQPMessage>().toEqualTypeOf<AMQPMessage<"plain">>()
})

test("AMQPMessage<plain>.body is Uint8Array | null", () => {
  expectTypeOf<AMQPMessage<"plain">["body"]>().toEqualTypeOf<Uint8Array | null>()
})

test("AMQPMessage<codec>.body is unknown", () => {
  expectTypeOf<AMQPMessage<"codec">["body"]>().toEqualTypeOf<unknown>()
})

test("MessageBody follows CodecMode", () => {
  expectTypeOf<MessageBody<"plain">>().toEqualTypeOf<Uint8Array | null>()
  expectTypeOf<MessageBody<"codec">>().toEqualTypeOf<unknown>()
})

test("AMQPMessage.rawBody is always Uint8Array | null", () => {
  expectTypeOf<AMQPMessage<"plain">["rawBody"]>().toEqualTypeOf<Uint8Array | null>()
  expectTypeOf<AMQPMessage<"codec">["rawBody"]>().toEqualTypeOf<Uint8Array | null>()
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

// --- Codec queue without parsers falls back to PlainBody ---

test("codec queue without parsers defaults to PlainBody", () => {
  type Q = AMQPQueue<"codec">
  type PublishBody = Parameters<Q["publish"]>[0]
  expectTypeOf<string>().toMatchTypeOf<PublishBody>()
  expectTypeOf<Uint8Array>().toMatchTypeOf<PublishBody>()
  expectTypeOf<null>().toMatchTypeOf<PublishBody>()
  expectTypeOf<{ key: string }>().not.toMatchTypeOf<PublishBody>()
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

// --- Subscribe yields typed messages ---

test("plain queue subscribe iterator yields AMQPMessage<plain>", () => {
  type Sub = AMQPGeneratorSubscription<"plain">
  type Yielded = Sub extends AsyncIterable<infer T> ? T : never
  expectTypeOf<Yielded>().toEqualTypeOf<AMQPMessage<"plain">>()
})

test("codec queue subscribe iterator yields AMQPMessage<codec>", () => {
  type Sub = AMQPGeneratorSubscription<"codec">
  type Yielded = Sub extends AsyncIterable<infer T> ? T : never
  expectTypeOf<Yielded>().toEqualTypeOf<AMQPMessage<"codec">>()
})

// --- RPC call returns typed messages ---

test("plain rpcClient.call returns AMQPMessage<plain>", () => {
  type R = AMQPRPCClient<"plain">
  type Reply = Awaited<ReturnType<R["call"]>>
  expectTypeOf<Reply>().toEqualTypeOf<AMQPMessage<"plain">>()
})

test("codec rpcClient.call returns AMQPMessage<codec>", () => {
  type R = AMQPRPCClient<"codec">
  type Reply = Awaited<ReturnType<R["call"]>>
  expectTypeOf<Reply>().toEqualTypeOf<AMQPMessage<"codec">>()
})

// --- RPCHandler receives typed messages ---

test("RPCHandler<plain> receives AMQPMessage<plain>", () => {
  type Param = Parameters<RPCHandler<"plain">>[0]
  expectTypeOf<Param>().toEqualTypeOf<AMQPMessage<"plain">>()
})

test("RPCHandler<codec> receives AMQPMessage<codec>", () => {
  type Param = Parameters<RPCHandler<"codec">>[0]
  expectTypeOf<Param>().toEqualTypeOf<AMQPMessage<"codec">>()
})

// --- CodecMode is a string literal union ---

test("CodecMode is exactly 'plain' | 'codec'", () => {
  expectTypeOf<CodecMode>().toEqualTypeOf<"plain" | "codec">()
})

// --- ResolveBody: content-type → body type cascade ---

type TestParsers = {
  "text/plain": AMQPParser<string>
  "application/json": AMQPParser
}

test("ResolveBody: explicit contentType selects that parser's input type", () => {
  // O = "application/json" (explicit), K = anything — O wins
  expectTypeOf<ResolveBody<TestParsers, "application/json">>().toEqualTypeOf<unknown>()
  expectTypeOf<ResolveBody<TestParsers, "text/plain">>().toEqualTypeOf<string>()
})

test("ResolveBody: no content type at all resolves to PlainBody", () => {
  // O = never (no explicit, no default)
  expectTypeOf<ResolveBody<TestParsers, never>>().toEqualTypeOf<PlainBody>()
})

test("queue with parsers and defaultContentType constrains body to default parser", () => {
  // K = "text/plain" → O defaults to "text/plain" → body must be string
  type Q = AMQPQueue<"codec", TestParsers, "text/plain">
  type PublishBody = Parameters<Q["publish"]>[0]
  expectTypeOf<PublishBody>().toEqualTypeOf<string>()
})

test("queue with parsers but no defaultContentType falls back to PlainBody", () => {
  // K = never → O defaults to never → PlainBody
  type Q = AMQPQueue<"codec", TestParsers, never>
  type PublishBody = Parameters<Q["publish"]>[0]
  expectTypeOf<PublishBody>().toEqualTypeOf<PlainBody>()
})
