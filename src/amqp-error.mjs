import AMQPBaseClient from './amqp-base-client.mjs'

/**
 * An error, can be both AMQP level errors or socket errors
 * @property {string} message
 * @property {AMQPBaseClient} connection - The connection the error was raised on
 */
export default class AMQPError extends Error {
  /**
   * @param {string} message
   * @param {AMQPBaseClient} connection - The connection the error was raised on
   */
  constructor(message, connection) {
    super(message)
    this.name = "AMQPError"
    this.connection = connection
  }
}
