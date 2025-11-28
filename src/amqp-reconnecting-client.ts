import type { AMQPBaseClient } from "./amqp-base-client.js"
import type { AMQPChannel, ConsumeParams, QueueParams, ExchangeParams, ExchangeType } from "./amqp-channel.js"
import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPConsumer, AMQPGeneratorConsumer } from "./amqp-consumer.js"
import type { AMQPQueue } from "./amqp-queue.js"
import type { AMQPProperties } from "./amqp-properties.js"
import { AMQPError } from "./amqp-error.js"
import type { Logger } from "./types.js"

/**
 * Consumer definition for recovery after reconnection
 */
interface ConsumerDefinition {
  queue: string
  params: ConsumeParams
  callback: ((msg: AMQPMessage) => void | Promise<void>) | undefined
  prefetch: number | undefined
}

/**
 * Options for reconnection behavior
 */
export interface ReconnectOptions {
  /**
   * Initial delay in milliseconds before reconnecting (default: 1000)
   */
  reconnectInterval?: number
  /**
   * Maximum delay in milliseconds between reconnection attempts (default: 30000)
   */
  maxReconnectInterval?: number
  /**
   * Multiplier for exponential backoff (default: 2)
   */
  backoffMultiplier?: number
  /**
   * Maximum number of reconnection attempts, 0 for infinite (default: 0)
   */
  maxRetries?: number
}

type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "stopped"

/**
 * High-level AMQP client with automatic reconnection and consumer recovery.
 *
 * This client wraps an AMQPBaseClient (AMQPClient or AMQPWebSocketClient) and provides:
 * - Automatic reconnection on connection loss
 * - Consumer recovery after reconnection
 * - Event callbacks for connection state changes
 *
 * @example
 * ```typescript
 * import { AMQPClient } from "@cloudamqp/amqp-client"
 * import { AMQPReconnectingClient } from "@cloudamqp/amqp-client/amqp-reconnecting-client"
 *
 * const baseClient = new AMQPClient("amqp://localhost")
 * const client = new AMQPReconnectingClient(baseClient, {
 *   reconnectInterval: 1000,
 *   maxRetries: 10
 * })
 *
 * client.onconnect = () => console.log("Connected")
 * client.ondisconnect = (err) => console.log("Disconnected:", err?.message)
 * client.onreconnecting = (attempt) => console.log("Reconnecting, attempt:", attempt)
 *
 * await client.start()
 * const q = await client.queue("my-queue")
 * await client.subscribe("my-queue", { noAck: false }, async (msg) => {
 *   console.log(msg.bodyString())
 *   await msg.ack()
 * })
 * ```
 */
export class AMQPReconnectingClient {
  private readonly clientFactory: () => AMQPBaseClient
  private client: AMQPBaseClient
  private connection: AMQPBaseClient | undefined
  private publishChannel: AMQPChannel | undefined
  private readonly options: Required<ReconnectOptions>
  private state: ConnectionState = "disconnected"
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private readonly consumerDefinitions: Map<string, ConsumerDefinition> = new Map()
  private activeConsumers: Map<string, AMQPConsumer | AMQPGeneratorConsumer> = new Map()
  private stopped = false

  /**
   * Logger instance for this client
   */
  get logger(): Logger | undefined {
    return this.client.logger
  }

  /**
   * Callback when connection is established
   */
  onconnect?: () => void

  /**
   * Callback when connection is lost
   * @param error - The error that caused the disconnection, if any
   */
  ondisconnect?: (error?: Error) => void

  /**
   * Callback when reconnection attempt is starting
   * @param attempt - Current reconnection attempt number
   */
  onreconnecting?: (attempt: number) => void

  /**
   * Callback when max retries reached and giving up
   * @param error - The last error encountered
   */
  onfailed?: (error?: Error) => void

  /**
   * Create a new AMQPReconnectingClient
   * @param client - A function that creates AMQPBaseClient instances, or an existing client to use as a template
   * @param options - Reconnection options
   */
  constructor(client: AMQPBaseClient | (() => AMQPBaseClient), options: ReconnectOptions = {}) {
    if (typeof client === "function") {
      this.clientFactory = client
      this.client = client()
    } else {
      // Store the constructor and arguments to recreate the client on reconnect
      this.client = client
      this.clientFactory = () => {
        // Create a new instance with the same type
        // This requires the client to have a compatible constructor signature
        const ClientClass = client.constructor as new (...args: unknown[]) => AMQPBaseClient
        // For AMQPClient or AMQPWebSocketClient, we can extract the URL from the client
        // This is a limitation - users should prefer the factory function approach
        return new ClientClass()
      }
    }
    this.options = {
      reconnectInterval: options.reconnectInterval ?? 1000,
      maxReconnectInterval: options.maxReconnectInterval ?? 30000,
      backoffMultiplier: options.backoffMultiplier ?? 2,
      maxRetries: options.maxRetries ?? 0,
    }
  }

  /**
   * Check if the client is currently connected
   */
  get connected(): boolean {
    return this.state === "connected" && this.connection !== undefined && !this.connection.closed
  }

  /**
   * Check if the client has been started (attempting to maintain a connection)
   */
  get started(): boolean {
    return this.state !== "disconnected" && this.state !== "stopped"
  }

  /**
   * Start the client and establish a connection.
   * Will automatically reconnect on connection loss.
   */
  async start(): Promise<void> {
    if (this.started) {
      return
    }

    this.stopped = false
    this.state = "connecting"

    // Start the supervisor loop that maintains the connection
    void this.supervisor()
    // Wait for the first connection
    return new Promise((resolve, reject) => {
      const checkConnection = () => {
        if (this.stopped) {
          reject(new AMQPError("Client stopped before connection established", this.client))
          return
        }
        if (this.connected) {
          resolve()
          return
        }
        if (this.state === "stopped") {
          reject(new AMQPError("Client stopped before connection established", this.client))
          return
        }
        // Check again in a short interval
        setTimeout(checkConnection, 50)
      }
      checkConnection()
    })
  }

  /**
   * Stop the client and close the connection.
   * Will not attempt to reconnect after calling this.
   */
  async stop(): Promise<void> {
    this.stopped = true
    this.state = "stopped"

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    // Clear consumer definitions and active consumers
    this.consumerDefinitions.clear()
    this.activeConsumers.clear()

    if (this.connection && !this.connection.closed) {
      try {
        await this.connection.close()
      } catch {
        // Ignore close errors
      }
    }
    this.connection = undefined
    this.publishChannel = undefined
  }

  /**
   * Declare a queue
   * @param name - Queue name (empty string for server-generated name)
   * @param params - Queue parameters
   * @param args - Additional arguments
   */
  async queue(
    name = "",
    params: QueueParams = {},
    args: Record<string, unknown> = {},
  ): Promise<AMQPQueue> {
    const ch = await this.getPublishChannel()
    return ch.queue(name, params, args)
  }

  /**
   * Declare an exchange
   * @param name - Exchange name
   * @param type - Exchange type
   * @param params - Exchange parameters
   * @param args - Additional arguments
   */
  async exchangeDeclare(
    name: string,
    type: ExchangeType,
    params: ExchangeParams = {},
    args: Record<string, unknown> = {},
  ): Promise<void> {
    const ch = await this.getPublishChannel()
    return ch.exchangeDeclare(name, type, params, args)
  }

  /**
   * Publish a message to an exchange
   * @param exchange - Exchange name
   * @param routingKey - Routing key
   * @param body - Message body
   * @param properties - Message properties
   */
  async publish(
    exchange: string,
    routingKey: string,
    body: string | Uint8Array | ArrayBuffer | Buffer | null,
    properties: AMQPProperties = {},
  ): Promise<number> {
    const ch = await this.getPublishChannel()
    return ch.basicPublish(exchange, routingKey, body, properties)
  }

  /**
   * Subscribe to a queue with automatic recovery on reconnection.
   * The consumer will be automatically re-established after a reconnection.
   *
   * @param queue - Queue name to subscribe to
   * @param params - Consumer parameters
   * @param callback - Function called for each message
   * @returns Consumer object (note: this may change after reconnection)
   */
  async subscribe(
    queue: string,
    params: ConsumeParams,
    callback: (msg: AMQPMessage) => void | Promise<void>,
  ): Promise<AMQPConsumer>
  async subscribe(queue: string, params: ConsumeParams): Promise<AMQPGeneratorConsumer>
  async subscribe(
    queue: string,
    params: ConsumeParams = {},
    callback?: (msg: AMQPMessage) => void | Promise<void>,
  ): Promise<AMQPConsumer | AMQPGeneratorConsumer> {
    const consumerId = this.generateConsumerId(queue, params.tag)

    // Store the consumer definition for recovery
    const definition: ConsumerDefinition = {
      queue,
      params,
      callback: callback,
      prefetch: undefined,
    }
    this.consumerDefinitions.set(consumerId, definition)

    // Create the actual consumer
    const consumer = await this.createConsumer(definition)
    this.activeConsumers.set(consumerId, consumer)

    return consumer
  }

  /**
   * Unsubscribe from a queue by consumer tag.
   * This will also remove the consumer from automatic recovery.
   *
   * @param consumerTag - Consumer tag to cancel
   */
  async unsubscribe(consumerTag: string): Promise<void> {
    // Find and remove the consumer definition
    for (const [id, consumer] of this.activeConsumers) {
      if (consumer.tag === consumerTag) {
        this.consumerDefinitions.delete(id)
        this.activeConsumers.delete(id)
        break
      }
    }

    // Cancel the actual consumer
    if (this.connection && !this.connection.closed) {
      const ch = await this.getPublishChannel()
      await ch.basicCancel(consumerTag)
    }
  }

  /**
   * Bind a queue to an exchange
   */
  async queueBind(
    queue: string,
    exchange: string,
    routingKey: string,
    args: Record<string, unknown> = {},
  ): Promise<void> {
    const ch = await this.getPublishChannel()
    return ch.queueBind(queue, exchange, routingKey, args)
  }

  /**
   * Unbind a queue from an exchange
   */
  async queueUnbind(
    queue: string,
    exchange: string,
    routingKey: string,
    args: Record<string, unknown> = {},
  ): Promise<void> {
    const ch = await this.getPublishChannel()
    return ch.queueUnbind(queue, exchange, routingKey, args)
  }

  /**
   * Delete a queue
   */
  async queueDelete(name: string, options: { ifUnused?: boolean; ifEmpty?: boolean } = {}): Promise<{ messageCount: number }> {
    const ch = await this.getPublishChannel()
    return ch.queueDelete(name, options)
  }

  /**
   * Delete an exchange
   */
  async exchangeDelete(name: string, options: { ifUnused?: boolean } = {}): Promise<void> {
    const ch = await this.getPublishChannel()
    return ch.exchangeDelete(name, options)
  }

  /**
   * Enable publisher confirms on the publish channel
   */
  async confirmSelect(): Promise<void> {
    const ch = await this.getPublishChannel()
    return ch.confirmSelect()
  }

  /**
   * Set QoS (prefetch) on the publish channel.
   * Note: For consumer-specific prefetch, set it in subscribe params
   */
  async prefetch(count: number): Promise<void> {
    const ch = await this.getPublishChannel()
    return ch.basicQos(count)
  }

  private async supervisor(): Promise<void> {
    while (!this.stopped) {
      try {
        // Create a fresh client for each connection attempt
        if (this.reconnectAttempts > 0) {
          try {
            this.client = this.clientFactory()
          } catch {
            // If factory fails, continue with reconnect delay
          }
        }

        this.state = this.reconnectAttempts > 0 ? "reconnecting" : "connecting"

        if (this.reconnectAttempts > 0) {
          this.onreconnecting?.(this.reconnectAttempts)
        }

        this.connection = await this.client.connect()
        this.reconnectAttempts = 0
        this.state = "connected"
        this.publishChannel = undefined // Will be lazily created

        // Set up error handler for this connection
        const originalOnerror = this.connection.onerror
        this.connection.onerror = (err: AMQPError) => {
          originalOnerror.call(this.connection, err)
          // Connection error will trigger the read loop to exit and cause reconnection
        }

        this.onconnect?.()

        // Recover consumers
        await this.recoverConsumers()

        // Wait for connection to close
        await this.waitForClose()

        // If we get here, connection was lost
        if (!this.stopped) {
          this.ondisconnect?.(new Error("Connection lost"))
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.logger?.warn("AMQP-Client reconnect error:", error.message)

        if (!this.stopped) {
          this.ondisconnect?.(error)
        }
      }

      // Clean up
      this.connection = undefined
      this.publishChannel = undefined

      if (this.stopped) {
        break
      }

      this.reconnectAttempts++

      // Check max retries
      if (this.options.maxRetries > 0 && this.reconnectAttempts > this.options.maxRetries) {
        this.state = "stopped"
        this.onfailed?.(new Error(`Max reconnection attempts (${this.options.maxRetries}) reached`))
        break
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        this.options.reconnectInterval * Math.pow(this.options.backoffMultiplier, this.reconnectAttempts - 1),
        this.options.maxReconnectInterval,
      )

      this.logger?.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

      // Wait before reconnecting
      await new Promise<void>((resolve) => {
        this.reconnectTimer = setTimeout(resolve, delay)
      })
    }
  }

  private async waitForClose(): Promise<void> {
    return new Promise<void>((resolve) => {
      const checkClosed = () => {
        if (!this.connection || this.connection.closed || this.stopped) {
          resolve()
          return
        }
        setTimeout(checkClosed, 100)
      }
      checkClosed()
    })
  }

  private async recoverConsumers(): Promise<void> {
    if (!this.connection || this.connection.closed) {
      return
    }

    this.activeConsumers.clear()

    for (const [consumerId, definition] of this.consumerDefinitions) {
      try {
        const consumer = await this.createConsumer(definition)
        this.activeConsumers.set(consumerId, consumer)
        this.logger?.debug(`Recovered consumer for queue: ${definition.queue}`)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.logger?.warn(`Failed to recover consumer for queue ${definition.queue}:`, error.message)
      }
    }
  }

  private async createConsumer(definition: ConsumerDefinition): Promise<AMQPConsumer | AMQPGeneratorConsumer> {
    if (!this.connection || this.connection.closed) {
      throw new AMQPError("Not connected", this.client)
    }

    const ch = await this.connection.channel()

    // Set prefetch if specified
    if (definition.prefetch !== undefined) {
      await ch.basicQos(definition.prefetch)
    }

    const q = await ch.queue(definition.queue, { passive: true })

    if (definition.callback) {
      return q.subscribe(definition.params, definition.callback)
    }
    return q.subscribe(definition.params)
  }

  private async getPublishChannel(): Promise<AMQPChannel> {
    if (!this.connection || this.connection.closed) {
      throw new AMQPError("Not connected", this.client)
    }

    if (this.publishChannel && !this.publishChannel.closed) {
      return this.publishChannel
    }

    this.publishChannel = await this.connection.channel()
    return this.publishChannel
  }

  private generateConsumerId(queue: string, tag?: string): string {
    return tag || `${queue}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }
}
