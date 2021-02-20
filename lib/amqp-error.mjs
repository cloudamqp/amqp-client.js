export default class AMQPError extends Error {
  constructor(message, connection) {
    super(message)
    this.name = "AMQPError"
    this.connection = connection
  }
}
