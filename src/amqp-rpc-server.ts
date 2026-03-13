import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"
import type { AMQPSubscription } from "./amqp-subscription.js"
import type { Body } from "./amqp-publisher.js"

function validateBody(body: unknown): Body {
  if (body === null || typeof body === "string" || body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return body as Body
  }
  throw new Error(
    "RPC handler returned a non-string/Buffer value but no codec registry is configured. " +
      "Configure codecs on the session or return a string/Uint8Array from the handler.",
  )
}

/**
 * Callback invoked for each incoming RPC request.
 * Return the response body to send back to the caller.
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
      const result = await handler(msg)
      const replyProps: AMQPProperties = {}
      if (correlationId !== undefined) replyProps.correlationId = correlationId
      if (this.session.codecs) {
        const defaults: { contentType?: string; contentEncoding?: string } = {}
        if (this.session.defaultContentType) defaults.contentType = this.session.defaultContentType
        if (this.session.defaultContentEncoding) defaults.contentEncoding = this.session.defaultContentEncoding
        const encoded = await this.session.codecs.serializeAndEncode(result, replyProps, defaults)
        const props: AMQPProperties = { ...encoded.properties }
        if (correlationId !== undefined) props.correlationId = correlationId
        await msg.channel.basicPublish("", replyTo, encoded.body, props)
      } else {
        await msg.channel.basicPublish("", replyTo, validateBody(result), replyProps)
      }
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
