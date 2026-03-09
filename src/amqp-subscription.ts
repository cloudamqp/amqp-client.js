import { AMQPGeneratorConsumer } from "./amqp-consumer.js"
import type { AMQPChannel } from "./amqp-channel.js"
import type { AMQPCodecRegistry } from "./amqp-codec-registry.js"
import type { AMQPConsumer } from "./amqp-consumer.js"
import type { AMQPMessage } from "./amqp-message.js"
import type { ConsumeParams } from "./amqp-channel.js"

/** @internal */
export interface ConsumerDefinition {
  queueName: string
  consumeParams: ConsumeParams
  callback?: (msg: AMQPMessage) => void | Promise<void>
  prefetch?: number
  codecs?: AMQPCodecRegistry
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
   * Cancel the subscription and remove it from session auto-recovery.
   * Safe to call on a closed channel.
   */
  async cancel(): Promise<void> {
    this.onCancel?.()
    await this.consumer.cancel()
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
export class AMQPGeneratorSubscription extends AMQPSubscription implements AsyncIterable<AMQPMessage> {
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

  async *[Symbol.asyncIterator](): AsyncGenerator<AMQPMessage, void, undefined> {
    const autoAck = !this.def.consumeParams.noAck
    let prev: AMQPMessage | undefined
    while (!this.stopped) {
      const consumer = this.consumer
      if (!(consumer instanceof AMQPGeneratorConsumer)) {
        throw new Error("Cannot iterate messages on a callback-based subscription")
      }
      try {
        for await (const msg of consumer.messages) {
          if (this.stopped) return
          if (autoAck) await prev?.ack()
          if (this.def.codecs) msg.codecRegistry = this.def.codecs
          prev = msg
          yield msg
        }
      } catch {
        // Consumer's channel was closed — wait for reconnect to provide a new consumer
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
