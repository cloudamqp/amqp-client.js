import type { AMQPMessage } from "./amqp-message.js"
import type { Body } from "./amqp-publisher.js"
import type { AMQPSession } from "./amqp-session.js"
import type { AMQPSubscription } from "./amqp-subscription.js"

/**
 * Callback invoked for each incoming RPC request.
 * Return the response body to send back to the caller.
 */
export type RPCHandler = (body: Body, msg: AMQPMessage) => Body | Promise<Body>

/**
 * An RPC server that consumes messages from a queue and replies to each caller.
 *
 * Uses the session's queue and subscribe machinery, so the consumer is
 * automatically recovered after a reconnection.
 *
 * @example
 * ```ts
 * const session = await AMQPSession.connect("amqp://localhost")
 * const server = await session.rpcServer("my_rpc_queue", async (body, msg) => {
 *   return `reply:${body}`
 * })
 * // later…
 * await session.stop()
 * ```
 */
export class AMQPRPCServer {
  private readonly session: AMQPSession
  private subscription: AMQPSubscription | null = null

  /** @internal Use {@link AMQPSession.rpcServer} instead. */
  constructor(session: AMQPSession) {
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
      const result = await handler(msg.body, msg)
      await msg.channel.basicPublish("", replyTo, result, {
        ...(correlationId !== undefined && { correlationId }),
      })
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
