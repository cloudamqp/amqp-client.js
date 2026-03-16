import type { AMQPBaseClient } from "./amqp-base-client.js"

/**
 * An error from the AMQP protocol or the underlying socket.
 */
export class AMQPError extends Error {
  /** The connection the error was raised on. */
  connection: AMQPBaseClient
  /**
   * @param message - Error description
   * @param connection - The connection the error was raised on
   */
  constructor(message: string, connection: AMQPBaseClient) {
    super(message)
    this.name = "AMQPError"
    this.connection = connection
  }
}
