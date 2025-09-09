import type { AMQPChannel } from './amqp-channel.js'
import type { AMQPQueue } from './amqp-queue.js'
import type { AMQPConsumer } from './amqp-consumer.js'
import type { AMQPMessage } from './amqp-message.js'
import type { AMQPProperties } from './amqp-properties.js'

/**
 * RPC method handler function
 */
export type RpcMethodHandler = (params: unknown, message: AMQPMessage) => unknown | Promise<unknown>

/**
 * Options for RPC server
 */
export interface RpcServerOptions {
  /** Whether to automatically acknowledge processed messages */
  autoAck?: boolean
  /** Number of unacknowledged messages to prefetch */
  prefetch?: number
  /** Whether the queue should be durable */
  durable?: boolean
  /** Additional queue arguments */
  queueArgs?: Record<string, unknown>
}

/**
 * A high-level RPC server for handling remote procedure calls over AMQP
 */
export class AMQPRpcServer {
  readonly channel: AMQPChannel
  readonly queueName: string
  private queue?: AMQPQueue
  private consumer?: AMQPConsumer
  private readonly methodHandlers = new Map<string, RpcMethodHandler>()
  private readonly options: RpcServerOptions
  private isStarted = false

  /**
   * @param channel - The AMQP channel to use for RPC communication
   * @param queueName - The queue name to listen for RPC requests
   * @param options - Server configuration options
   */
  constructor(channel: AMQPChannel, queueName: string, options: RpcServerOptions = {}) {
    this.channel = channel
    this.queueName = queueName
    this.options = {
      autoAck: true,
      prefetch: 1,
      durable: false,
      queueArgs: {},
      ...options
    }
  }

  /**
   * Register a method handler
   * @param method - The method name to handle
   * @param handler - The handler function for this method
   */
  register(method: string, handler: RpcMethodHandler): void {
    if (this.isStarted) {
      throw new Error('Cannot register methods after server has started')
    }
    this.methodHandlers.set(method, handler)
  }

  /**
   * Unregister a method handler
   * @param method - The method name to unregister
   */
  unregister(method: string): void {
    this.methodHandlers.delete(method)
  }

  /**
   * Start the RPC server
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error('RPC server is already started')
    }

    // Set prefetch if specified
    if (this.options.prefetch) {
      await this.channel.prefetch(this.options.prefetch)
    }

    // Declare the queue
    const queueOptions = this.options.durable !== undefined ? { durable: this.options.durable } : {}
    this.queue = await this.channel.queue(this.queueName, queueOptions, this.options.queueArgs)

    // Start consuming messages
    const consumeOptions = this.options.autoAck !== undefined ? { noAck: this.options.autoAck, exclusive: false } : { exclusive: false }
    this.consumer = await this.queue.subscribe(
      consumeOptions,
      (msg: AMQPMessage) => this.handleMessage(msg)
    )

    this.isStarted = true
  }

  /**
   * Stop the RPC server
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return
    }

    if (this.consumer) {
      await this.consumer.cancel()
    }

    this.isStarted = false
  }

  /**
   * Handle incoming RPC messages
   */
  private async handleMessage(msg: AMQPMessage): Promise<void> {
    const { correlationId, replyTo } = msg.properties
    
    if (!correlationId || !replyTo) {
      // Invalid RPC message, acknowledge if not auto-ack
      if (!this.options.autoAck) {
        msg.nack(false, false) // Don't requeue
      }
      return
    }

    const response: { result?: unknown; error?: string } = {}

    try {
      const bodyString = msg.bodyString()
      if (!bodyString) {
        throw new Error('Empty RPC request body')
      }
      const request = JSON.parse(bodyString)
      const { method, params } = request

      if (!method || typeof method !== 'string') {
        throw new Error('Invalid RPC request: missing or invalid method')
      }

      const handler = this.methodHandlers.get(method)
      if (!handler) {
        throw new Error(`Unknown RPC method: ${method}`)
      }

      // Execute the handler
      const result = await handler(params, msg)
      response.result = result

    } catch (errorObj) {
      // Handle errors
      const errorMessage = errorObj instanceof Error ? errorObj.message : String(errorObj)
      response.error = errorMessage
    }

    try {
      // Send the response
      const responseProperties: AMQPProperties = {
        correlationId,
        contentType: 'application/json'
      }

      await this.channel.basicPublish('', replyTo, JSON.stringify(response), responseProperties)

      // Acknowledge the message if not auto-ack
      if (!this.options.autoAck) {
        msg.ack()
      }

    } catch {
      // Failed to send response, nack the message if not auto-ack
      if (!this.options.autoAck) {
        msg.nack(false, false) // Don't requeue
      }
    }
  }

  /**
   * Get the list of registered method names
   */
  getMethods(): string[] {
    return Array.from(this.methodHandlers.keys())
  }

  /**
   * Check if the server is currently running
   */
  isRunning(): boolean {
    return this.isStarted
  }
}