import AMQPBaseClient from './amqp-base-client.js';
/**
 * WebSocket client for AMQP 0-9-1 servers
 * @param url to the websocket endpoint
 * @param vhost, default '/'
 * @param username, default 'guest'
 * @param password, default 'guest'
 * @param name of the connection, no default
 */
export default class AMQPWebSocketClient extends AMQPBaseClient {
    url: string;
    private socket;
    constructor(url: any, vhost?: string, username?: string, password?: string, name?: any);
    /**
     * Establish a AMQP connection over WebSocket
     * @return Promise to returns itself when successfully connected
     */
    connect(): Promise<AMQPWebSocketClient>;
    /**
     * @ignore
     * @param bytes to send
     * @return fulfilled when the data is enqueued
     */
    send(bytes: Uint8Array): Promise<any>;
    /**
     * @ignore
     */
    closeSocket(): void;
}
//# sourceMappingURL=amqp-websocket-client.d.ts.map