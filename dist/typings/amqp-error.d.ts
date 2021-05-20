import AMQPBaseClient from "./amqp-base-client.js";
/**
 * An error, can be both AMQP level errors or socket errors
 * @param message
 * @param connection - The connection the error was raised on
 * @property {AMQPBaseClient} connection
 * @property {string} message
 */
export default class AMQPError extends Error {
    connection: AMQPBaseClient;
    constructor(message: string, connection: AMQPBaseClient);
}
//# sourceMappingURL=amqp-error.d.ts.map