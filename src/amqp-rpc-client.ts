import type { AMQPChannel } from "./amqp-channel.js"
import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"
import type { Body, CodecMode } from "./amqp-publisher.js"

const DIRECT_REPLY_TO = "amq.rabbitmq.reply-to"

/**
 * Reusable RPC client using the direct reply-to feature.
 *
 * @example
 * ```ts
 * const session = await AMQPSession.connect("amqp://localhost")
 * const rpc = await session.rpcClient() // tracked for reconnect recovery
 * const reply = await rpc.call("my_queue", "request body")
 * console.log(reply.bodyString())
 * await rpc.close()
 * ```
 */
export class AMQPRPCClient<C extends CodecMode = "plain"> {
  private readonly session: AMQPSession<C>
  private ch: AMQPChannel | null = null
  private correlationId = 0
  private readonly pending = new Map<
    string,
    {
      resolve: (msg: AMQPMessage) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout> | undefined
    }
  >()
  private closed = false

  /** @internal Use {@link AMQPSession.rpcClient} instead. */
  constructor(session: AMQPSession<C>) {
    this.session = session
  }

  /** @internal Called by {@link AMQPSession.rpcClient}. */
  async start(): Promise<this> {
    if (this.closed) throw new Error("RPC client is closed")
    if (this.ch && !this.ch.closed) return this
    const ch = await this.session.openChannel()
    try {
      // Direct reply-to is scoped per-channel by RabbitMQ, so only replies
      // for this client arrive here.  Messages with an unknown correlationId
      // (e.g. late replies after a timeout) are intentionally dropped — with
      // noAck: true they are acknowledged on delivery and cannot be requeued.
      const codecs = this.session.codecs
      await ch.basicConsume(DIRECT_REPLY_TO, { noAck: true }, async (msg) => {
        const id = msg.properties.correlationId
        if (id === undefined) return
        const entry = this.pending.get(id)
        if (!entry) return
        this.pending.delete(id)
        if (entry.timer) clearTimeout(entry.timer)
        try {
          if (codecs) await codecs.decodeMessage(msg)
          entry.resolve(msg)
        } catch (err) {
          entry.reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
      this.ch = ch
      return this
    } catch (err) {
      ch.close().catch(() => {})
      throw err
    }
  }

  /**
   * Perform an RPC call: publish a message and wait for the response.
   *
   * @param queue - The queue name (routing key) of the RPC server
   * @param body - The request body
   * @param options - Optional properties and timeout
   * @param options.timeout - Timeout in milliseconds. Rejects with an error if
   *                          no response is received within this time.
   * @returns The reply {@link AMQPMessage}
   */
  async call(
    queue: string,
    body: Body<C>,
    { timeout, ...properties }: AMQPProperties & { timeout?: number } = {},
  ): Promise<AMQPMessage> {
    if (this.closed) throw new Error("RPC client is closed")
    if (!this.ch || this.ch.closed) throw new Error("RPC client not started, call start() first")
    const ch = this.ch
    const correlationId = (++this.correlationId).toString(36)

    const encoded = await this.session.encodeBody(body, properties)

    return new Promise<AMQPMessage>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      if (timeout !== undefined && timeout > 0) {
        timer = setTimeout(() => {
          this.pending.delete(correlationId)
          reject(new Error(`No response received in ${timeout}ms`))
        }, timeout)
      }

      this.pending.set(correlationId, { resolve, reject, timer })

      ch.basicPublish("", queue, encoded.body, {
        ...encoded.properties,
        replyTo: DIRECT_REPLY_TO,
        correlationId,
      }).catch((err) => {
        const entry = this.pending.get(correlationId)
        if (!entry) return
        this.pending.delete(correlationId)
        if (entry.timer) clearTimeout(entry.timer)
        entry.reject(err)
      })
    })
  }

  /**
   * Re-establish the channel and consumer after a reconnection.
   * All pending calls are rejected since the old channel is gone.
   * @internal Called by the session's reconnect loop.
   */
  async recover(): Promise<void> {
    if (this.closed) return
    this.rejectAllPending(new Error("RPC client reconnecting"))
    this.ch = null
    await this.start()
  }

  /**
   * Close the dedicated channel, reject any pending calls, and remove
   * this client from the session's reconnect recovery.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.session.untrackRPCClient(this)
    this.rejectAllPending(new Error("RPC client closed"))
    const ch = this.ch
    this.ch = null
    if (ch && !ch.closed) {
      await ch.close()
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(err)
      this.pending.delete(id)
    }
  }
}
