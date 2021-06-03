/**
 * An error, can be both AMQP level errors or socket errors
 * @param message
 * @param connection - The connection the error was raised on
 * @property {AMQPBaseClient} connection
 * @property {string} message
 */
export default class AMQPError extends Error {
    constructor(message, connection) {
        super(message);
        this.name = "AMQPError";
        this.connection = connection;
    }
}
