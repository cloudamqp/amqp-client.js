import { AMQPError } from './amqp-error.js'
import type { AMQPChannel } from './amqp-channel.js'
import type { AMQPQueue } from './amqp-queue.js'
import type { AMQPConsumer } from './amqp-consumer.js'
import type { AMQPMessage } from './amqp-message.js'
import type { AMQPProperties } from './amqp-properties.js'

/**
 * Options for RPC calls
 */
export interface RpcCallOptions {
  /** Timeout in milliseconds for the RPC call */
  timeout?: number
  /** Additional properties to include in the request message */
  properties?: AMQPProperties
}

/**
 * A high-level RPC client for making remote procedure calls over AMQP
 */
export class AMQPRpcClient {
  readonly channel: AMQPChannel
  readonly targetQueue: string
  private replyQueue?: AMQPQueue
  private replyConsumer?: AMQPConsumer
  private readonly pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout?: ReturnType<typeof setTimeout>
  }>()
  private correlationCounter = 0

  /**
   * @param channel - The AMQP channel to use for RPC communication
   * @param targetQueue - The target queue where RPC requests will be sent
   */
  constructor(channel: AMQPChannel, targetQueue: string) {
    this.channel = channel
    this.targetQueue = targetQueue
  }

  /**
   * Initialize the reply queue and consumer
   */
  private async ensureReplyQueue(): Promise<void> {
    if (this.replyQueue && this.replyConsumer) {
      return
    }

    // Create an exclusive temporary queue for replies
    this.replyQueue = await this.channel.queue('', { exclusive: true, autoDelete: true })
    
    // Start consuming replies
    this.replyConsumer = await this.replyQueue.subscribe({ noAck: true }, (msg: AMQPMessage) => {
      const correlationId = msg.properties.correlationId
      if (!correlationId) {
        return // Ignore messages without correlation ID
      }

      const pendingRequest = this.pendingRequests.get(correlationId)
      if (!pendingRequest) {
        return // No matching request found
      }

      // Clear timeout if set
      if (pendingRequest.timeout) {
        clearTimeout(pendingRequest.timeout)
      }

      // Remove from pending requests
      this.pendingRequests.delete(correlationId)

      try {
        const bodyString = msg.bodyString()
        if (!bodyString) {
          pendingRequest.reject(new AMQPError('Empty RPC response body', this.channel.connection))
          return
        }
        const response = JSON.parse(bodyString)
        if (response.error) {
          pendingRequest.reject(new AMQPError(response.error, this.channel.connection))
        } else {
          pendingRequest.resolve(response.result)
        }
      } catch {
        pendingRequest.reject(new AMQPError('Failed to parse RPC response', this.channel.connection))
      }
    })
  }

  /**
   * Make an RPC call
   * @param method - The RPC method name
   * @param params - Parameters for the RPC method
   * @param options - Additional options for the call
   * @returns Promise that resolves with the RPC result
   */
  async call<T = unknown>(method: string, params: unknown = {}, options: RpcCallOptions = {}): Promise<T> {
    await this.ensureReplyQueue()

    const correlationId = `rpc-${++this.correlationCounter}-${Date.now()}`
    const timeout = options.timeout || 30000 // Default 30 second timeout

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(correlationId)
        reject(new AMQPError(`RPC call to ${method} timed out after ${timeout}ms`, this.channel.connection))
      }, timeout)

      // Store the pending request  
      this.pendingRequests.set(correlationId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutId
      })

      // Prepare the request message
      const request = {
        method,
        params
      }

      const messageProperties: AMQPProperties = {
        correlationId,
        replyTo: this.replyQueue!.name,
        contentType: 'application/json',
        ...options.properties
      }

      // Send the request
      this.channel.basicPublish('', this.targetQueue, JSON.stringify(request), messageProperties)
        .catch((err) => {
          // Clean up on send failure
          this.pendingRequests.delete(correlationId)
          clearTimeout(timeoutId)
          reject(err)
        })
    })
  }

  /**
   * Close the RPC client and clean up resources
   */
  async close(): Promise<void> {
    // Cancel all pending requests
    for (const [, pendingRequest] of this.pendingRequests) {
      if (pendingRequest.timeout) {
        clearTimeout(pendingRequest.timeout)
      }
      pendingRequest.reject(new AMQPError('RPC client is closing', this.channel.connection))
    }
    this.pendingRequests.clear()

    // Close consumer and delete reply queue
    if (this.replyConsumer) {
      await this.replyConsumer.cancel()
    }
    if (this.replyQueue) {
      await this.replyQueue.delete()
    }
  }
}