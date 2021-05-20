import AMQPBaseClient from './amqp-base-client.js';
/**
 * AMQP 0-9-1 client over TCP socket.
 * @param url - uri to the server, example: amqp://user:passwd@localhost:5672/vhost
 */
export default class AMQPClient extends AMQPBaseClient {
    private tls;
    private host;
    private port;
    private socket;
    constructor(url: string);
    /**
     * Try establish a connection
     * @returns
     */
    connect(): Promise<AMQPClient>;
    /**
     * @ignore
     * Sends a set of bytes to the AMQP server
     * @param bytes
     * @returns
     */
    send(bytes: Uint8Array): Promise<string>;
    /**
     * @ignore
     * Closes the connection.
     */
    closeSocket(): void;
    private connectPlain;
    private connectTLS;
    private socketOnData;
}
//# sourceMappingURL=amqp-socket-client.d.ts.map