import { AMQPGeneratorConsumer } from "./amqp-consumer.js"
import type { AMQPChannel } from "./amqp-channel.js"
import type { AMQPConsumer } from "./amqp-consumer.js"
import type { AMQPMessage } from "./amqp-message.js"
import type { ConsumeParams } from "./amqp-channel.js"
import { decodeMessage } from "./amqp-codec-registry.js"
import type { ParserMap, CoderMap } from "./amqp-codec-registry.js"

/** @internal */
export interface ConsumerDefinition {
  queueName: string
  consumeParams: ConsumeParams
  callback?: (msg: AMQPMessage) => void | Promise<void>
  prefetch?: number
  parsers?: ParserMap
  coders?: CoderMap
  requeueOnNack?: boolean
  manualAck?: boolean
}

/**
 * A persistent queue subscription returned by {@link AMQPQueue.subscribe}.
 *
 * Remains valid across reconnections — the underlying channel and consumer tag
 * are swapped in-place after each reconnect. Use `cancel()` to unsubscribe and
 * remove from auto-recovery.
 */
export class AMQPSubscription {
  protected consumer: AMQPConsumer
  /** @internal Consumer definition used for recovery after reconnect. */
  readonly def: ConsumerDefinition

  /** @internal */
  onCancel?: () => void

  /** @internal */
  constructor(consumer: AMQPConsumer, def: ConsumerDefinition) {
    this.consumer = consumer
    this.def = def
  }

  /** The underlying channel. Reflects the most recent channel after a reconnect. */
  get channel(): AMQPChannel {
    return this.consumer.channel
  }

  /** The consumer tag. Reflects the most recent tag after a reconnect. */
  get consumerTag(): string {
    return this.consumer.tag
  }

  /**
   * Cancel the subscription, close its dedicated channel, and remove it
   * from session auto-recovery.
   *
   * The subscription owns the channel that `queue.subscribe()` opened
   * for it, so cancelling here also closes that channel — otherwise
   * each cancelled subscription leaks a channel until the connection
   * drops.
   *
   * Best-effort: never throws on wire-level failures. If the channel
   * dropped mid-cancel or the broker is gone, the consumer is already
   * effectively dead — there's nothing for the caller to recover from,
   * so swallowing the error means call sites don't need `.catch(() => {})`
   * boilerplate around every cancel.
   */
  async cancel(): Promise<void> {
    this.onCancel?.()
    const ch = this.consumer.channel
    try {
      await this.consumer.cancel()
    } catch {
      // Channel/connection closed before basic.cancel could complete —
      // the consumer is gone either way.
    }
    if (!ch.closed) {
      try {
        await ch.close()
      } catch {
        // Channel/connection dropped before close could complete.
      }
    }
  }

  /**
   * Swap in a new underlying consumer after reconnect.
   * @internal
   */
  setConsumer(consumer: AMQPConsumer): void {
    this.consumer = consumer
  }
}

/**
 * A persistent queue subscription that yields messages via an async iterator.
 * Returned by {@link AMQPQueue.subscribe} when no callback is provided.
 *
 * Bridges across reconnections — the iterator continues yielding after each
 * reconnect without the caller needing to re-subscribe.
 *
 * @example
 * ```ts
 * const sub = await session.subscribe("my-queue", { noAck: true })
 * for await (const msg of sub) {
 *   console.log(msg.bodyString())
 * }
 * ```
 */
export class AMQPGeneratorSubscription<P extends ParserMap = {}>
  extends AMQPSubscription
  implements AsyncIterable<AMQPMessage<P>>
{
  private stopped = false
  private consumerReady?: () => void

  override setConsumer(consumer: AMQPConsumer): void {
    super.setConsumer(consumer)
    this.consumerReady?.()
    delete this.consumerReady
  }

  override async cancel(): Promise<void> {
    this.stopped = true
    this.consumerReady?.()
    delete this.consumerReady
    await super.cancel()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<AMQPMessage<P>, void, undefined> {
    const autoAck = !this.def.consumeParams.noAck && !this.def.manualAck
    const requeueOnNack = this.def.requeueOnNack ?? true
    let prev: AMQPMessage | undefined
    while (!this.stopped) {
      const consumer = this.consumer
      if (!(consumer instanceof AMQPGeneratorConsumer)) {
        throw new Error("Cannot iterate messages on a callback-based subscription")
      }
      let decodeError: unknown
      try {
        for await (const msg of consumer.messages) {
          if (this.stopped) return
          if (autoAck) await prev?.ack()
          if (this.def.parsers || this.def.coders) {
            try {
              await decodeMessage(msg, this.def.parsers ?? {}, this.def.coders ?? {})
            } catch (err) {
              if (autoAck) {
                await msg.nack(requeueOnNack)
                continue
              }
              decodeError = err
              throw err
            }
          }
          prev = msg
          yield msg as AMQPMessage<P>
        }
      } catch (err) {
        // Decode errors should propagate to the caller.
        if (err === decodeError) throw err
        // Channel/connection close errors are expected during reconnect — swallow them.
      }
      // Reset on disconnect; unacked messages are requeued by the server when the channel closes
      prev = undefined
      if (!this.stopped) {
        await new Promise<void>((resolve) => {
          this.consumerReady = resolve
        })
      }
    }
  }
}
