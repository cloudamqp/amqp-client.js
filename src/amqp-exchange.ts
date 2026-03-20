import type { AMQPProperties } from "./amqp-properties.js"
import type { AMQPSession } from "./amqp-session.js"
import type { ResolveBody } from "./amqp-publisher.js"
import { serializeAndEncode } from "./amqp-codec-registry.js"
import type { ParserMap, CoderMap } from "./amqp-codec-registry.js"

/** Options for {@link AMQPExchange#publish}. */
export type ExchangePublishOptions<O extends string = string> = Omit<AMQPProperties, "contentType"> & {
  /** Routing key. Defaults to `""`. */
  routingKey?: string
  /** Wait for broker confirmation. Defaults to `true`. */
  confirm?: boolean
  contentType?: O
}

/**
 * Session-level exchange handle returned by {@link AMQPSession#exchange} and its
 * convenience variants ({@link AMQPSession#directExchange}, etc.).
 *
 * All operations are reconnect-safe: they acquire a session channel on each
 * call. `publish` waits for a broker confirm; pass `{ confirm: false }` to skip the wait.
 */
export class AMQPExchange<
  P extends ParserMap = {},
  C extends CoderMap = {},
  KP extends keyof P & string = never,
  KC extends keyof C & string = never,
> {
  /** Exchange name. */
  readonly name: string
  private readonly session: AMQPSession<P, C, KP, KC>

  /** @internal */
  constructor(session: AMQPSession<P, C, KP, KC>, name: string) {
    this.session = session
    this.name = name
  }

  /**
   * Publish a message to this exchange.
   *
   * When the session has parsers configured, `body` can be any value accepted
   * by the matching parser's `serialize` method. Without parsers, `body` must
   * be a string, Buffer, Uint8Array, or null.
   *
   * @param options - routing key, publish properties; set `confirm: false` to skip broker confirmation
   * @returns `this` for chaining
   */
  async publish<O extends keyof P & string = KP>(
    body: ResolveBody<P, O>,
    options: ExchangePublishOptions<O> = {},
  ): Promise<AMQPExchange<P, C, KP, KC>> {
    const { confirm = true, routingKey = "", ...properties } = options
    const defaults: { contentType?: string; contentEncoding?: string } = {}
    if (this.session.defaultContentType) defaults.contentType = this.session.defaultContentType
    if (this.session.defaultContentEncoding) defaults.contentEncoding = this.session.defaultContentEncoding
    const encoded = await serializeAndEncode(
      this.session.parsers ?? {},
      this.session.coders ?? {},
      body,
      properties,
      defaults,
    )
    const ch = confirm ? await this.session.getConfirmChannel() : await this.session.getOpsChannel()
    await ch.basicPublish(this.name, routingKey, encoded.body, encoded.properties)
    return this
  }

  /**
   * Bind this exchange to a source exchange.
   * @param source - name or {@link AMQPExchange} to bind from
   * @returns `this` for chaining
   */
  async bind(
    source: string | AMQPExchange<P, C, KP, KC>,
    routingKey = "",
    args: Record<string, unknown> = {},
  ): Promise<AMQPExchange<P, C, KP, KC>> {
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
    source: string | AMQPExchange<P, C, KP, KC>,
    routingKey = "",
    args: Record<string, unknown> = {},
  ): Promise<AMQPExchange<P, C, KP, KC>> {
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
