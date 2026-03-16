import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"
import { publishConfirmed, publishNoConfirm } from "./amqp-publisher.js"
import type { Body } from "./amqp-publisher.js"
import type { CodecMode } from "./amqp-message.js"

/** Options for {@link AMQPExchange#publish}. */
export type ExchangePublishOptions = AMQPProperties & {
  /** Routing key. Defaults to `""`. */
  routingKey?: string
  /** Wait for broker confirmation. Defaults to `true`. */
  confirm?: boolean
}

/**
 * Session-level exchange handle returned by {@link AMQPSession#exchange} and its
 * convenience variants ({@link AMQPSession#directExchange}, etc.).
 *
 * All operations are reconnect-safe: they acquire a session channel on each
 * call. `publish` waits for a broker confirm; pass `{ confirm: false }` to skip the wait.
 */
export class AMQPExchange<C extends CodecMode = "plain"> {
  /** Exchange name. */
  readonly name: string
  private readonly session: AMQPSession<C>

  /** @internal */
  constructor(session: AMQPSession<C>, name: string) {
    this.session = session
    this.name = name
  }

  /**
   * Publish a message to this exchange.
   *
   * When the session has a codec registry configured, `body` can be any value
   * (objects, arrays, etc.) and will be serialized according to `contentType`.
   * Without codecs, `body` must be a string, Buffer, Uint8Array, or null.
   *
   * @param options - routing key, publish properties; set `confirm: false` to skip broker confirmation
   * @returns `this` for chaining
   */
  async publish(body: Body<C>, options: ExchangePublishOptions = {}): Promise<AMQPExchange<C>> {
    const { confirm = true, routingKey = "", ...properties } = options
    if (confirm) {
      await publishConfirmed(this.session, this.name, routingKey, body, properties)
    } else {
      await publishNoConfirm(this.session, this.name, routingKey, body, properties)
    }
    return this
  }

  /**
   * Bind this exchange to a source exchange.
   * @param source - name or {@link AMQPExchange} to bind from
   * @returns `this` for chaining
   */
  async bind(
    source: string | AMQPExchange<C>,
    routingKey = "",
    args: Record<string, unknown> = {},
  ): Promise<AMQPExchange<C>> {
    const sourceName = typeof source === "string" ? source : source.name
    const ch = await this.session.getOpsChannel()
    await ch.exchangeBind(this.name, sourceName, routingKey, args)
    return this
  }

  /**
   * Remove a binding between this exchange and a source exchange.
   * @param source - name or {@link AMQPExchange} to unbind from
   * @returns `this` for chaining
   */
  async unbind(
    source: string | AMQPExchange<C>,
    routingKey = "",
    args: Record<string, unknown> = {},
  ): Promise<AMQPExchange<C>> {
    const sourceName = typeof source === "string" ? source : source.name
    const ch = await this.session.getOpsChannel()
    await ch.exchangeUnbind(this.name, sourceName, routingKey, args)
    return this
  }

  /**
   * Delete this exchange.
   * @param [params.ifUnused=false] - only delete if the exchange has no bindings
   */
  async delete(params?: { ifUnused?: boolean }): Promise<void> {
    const ch = await this.session.getOpsChannel()
    await ch.exchangeDelete(this.name, params)
  }
}
