/**
 * Narrow structural interfaces for the high-level session/queue/exchange
 * surface. Use these in tests to declare typed mocks without having to
 * implement the full {@link AMQPSession} class (which carries private
 * fields, internal channels, reconnect state, etc).
 *
 * The real classes are structurally assignable to these — `AMQPSession`
 * satisfies `AMQPSessionLike` — so application code can keep using the
 * concrete classes while tests substitute lightweight fakes.
 *
 * @example
 * ```ts
 * import type { AMQPSessionLike, AMQPQueueLike } from "@cloudamqp/amqp-client"
 *
 * class FakeSession implements AMQPSessionLike {
 *   async queue(): Promise<AMQPQueueLike> { return new FakeQueue() }
 *   async stop(): Promise<void> {}
 *   // ...
 * }
 * ```
 */

import type { AMQPMessage } from "./amqp-message.js"
import type { ExchangeType } from "./amqp-channel.js"
import type { ExchangeOptions, QueueOptions } from "./amqp-session.js"
import type { AMQPProperties } from "./amqp-properties.js"
import type { QueueSubscribeParams } from "./amqp-queue.js"

/** Minimum surface a mock subscription must expose. */
export interface AMQPSubscriptionLike {
  cancel(): Promise<void>
}

/** Minimum surface a mock queue handle must expose. */
export interface AMQPQueueLike {
  readonly name: string
  publish(body: unknown, options?: AMQPProperties & { confirm?: boolean }): Promise<unknown>
  subscribe(
    params: QueueSubscribeParams,
    callback: (msg: AMQPMessage) => void | Promise<void>,
  ): Promise<AMQPSubscriptionLike>
  bind(exchange: string, routingKey?: string, args?: Record<string, unknown>): Promise<unknown>
  get(params?: { noAck?: boolean }): Promise<AMQPMessage | null>
  consumeOne(options?: { timeout?: number }): Promise<AMQPMessage>
}

/** Minimum surface a mock exchange handle must expose. */
export interface AMQPExchangeLike {
  publish(
    body: unknown,
    options?: AMQPProperties & { routingKey?: string; confirm?: boolean },
  ): Promise<unknown>
}

/** Minimum surface a mock session must expose. */
export interface AMQPSessionLike {
  readonly closed: boolean
  queue(name: string, options?: QueueOptions): Promise<AMQPQueueLike>
  exchange(name: string, type: ExchangeType, options?: ExchangeOptions): Promise<AMQPExchangeLike>
  directExchange(name?: string, options?: ExchangeOptions): Promise<AMQPExchangeLike>
  fanoutExchange(name?: string, options?: ExchangeOptions): Promise<AMQPExchangeLike>
  topicExchange(name?: string, options?: ExchangeOptions): Promise<AMQPExchangeLike>
  headersExchange(name?: string, options?: ExchangeOptions): Promise<AMQPExchangeLike>
  stop(reason?: string): Promise<void>
}
