import { AMQPBaseClient } from './amqp-base-client.js'

/**
 * An error, can be both AMQP level errors or socket errors
 * @property {string} message
 * @property {AMQPBaseClient} connection - The connection the error was raised on
 */
export class AMQPError extends Error {
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
