import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPProperties } from "./amqp-properties.js"
import type { CodecMode } from "./amqp-message.js"
import type { PublishBody } from "./amqp-publisher.js"
import type { AMQPSession } from "./amqp-session.js"
import type { AMQPSubscription } from "./amqp-subscription.js"

/**
 * Callback invoked for each incoming RPC request.
 * Receives a decoded {@link AMQPMessage} and returns the response body.
 */
export type RPCHandler = (msg: AMQPMessage) => unknown | Promise<unknown>

/**
 * An RPC server that consumes messages from a queue and replies to each caller.
 *
 * Uses the session's queue and subscribe machinery, so the consumer is
 * automatically recovered after a reconnection.
 *
 * @example
 * ```ts
 * const session = await AMQPSession.connect("amqp://localhost")
 * const server = await session.rpcServer("my_rpc_queue", async (msg) => {
 *   return `processed:${msg.bodyString()}`
 * })
 * // later…
 * await session.stop()
 * ```
 */
export class AMQPRPCServer<C extends CodecMode = "plain"> {
  private readonly session: AMQPSession<C>
  private subscription: AMQPSubscription | null = null

  /** @internal Use {@link AMQPSession.rpcServer} instead. */
  constructor(session: AMQPSession<C>) {
    this.session = session
  }

  /** @internal Called by {@link AMQPSession.rpcServer}. */
  async start(queue: string, handler: RPCHandler, prefetch = 1): Promise<this> {
    if (this.subscription) throw new Error("RPC server already started")
    const q = await this.session.queue(queue)
    this.subscription = await q.subscribe({ prefetch, noAck: false, requeueOnNack: false }, async (msg) => {
      const { replyTo, correlationId } = msg.properties
      if (!replyTo) {
        await msg.nack(false)
        return
      }
      const result = await handler(msg)
      const replyProps: AMQPProperties = {}
      if (correlationId !== undefined) replyProps.correlationId = correlationId
      const encoded = await this.session.encodeBody(result as PublishBody<C>, replyProps)
      await msg.channel.basicPublish("", replyTo, encoded.body, encoded.properties)
    })
    return this
  }

  /**
   * Cancel the consumer. The underlying queue remains declared.
   */
  async close(): Promise<void> {
    const sub = this.subscription
    if (!sub) return
    this.subscription = null
    const ch = sub.channel
    await sub.cancel()
    if (!ch.closed) await ch.close()
  }
}
