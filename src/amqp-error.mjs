/**
 * An error, can be both AMQP level errors or socket errors
 * @param {string} message
 * @param {AMQPBaseClient} connection - The connection the error was raised on
 * @property {string} message
 * @property {AMQPBaseClient} connection - The connection the error was raised on
 */
export default class AMQPError extends Error {
  constructor(message, connection) {
    super(message)
    this.name = "AMQPError"
    this.connection = connection
  }
}
