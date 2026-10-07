import type { AMQPBaseClient } from "./amqp-base-client.js"

/**
 * An error from the AMQP protocol or the underlying socket.
 */
export class AMQPError extends Error {
  /** The connection the error was raised on. */
  connection: AMQPBaseClient
  /**
   * The AMQP reply code when the broker closed the channel or connection,
   * e.g. `403` (ACCESS_REFUSED) or `404` (NOT_FOUND). Undefined for
   * socket-level and client-side errors.
   */
  readonly code?: number
  /**
   * @param message - Error description
   * @param connection - The connection the error was raised on
   * @param code - AMQP reply code, when the error came from a broker close
   */
  constructor(message: string, connection: AMQPBaseClient, code?: number) {
    super(message)
    this.name = "AMQPError"
    this.connection = connection
    if (code !== undefined) this.code = code
  }
}
