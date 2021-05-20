import AMQPChannel from './amqp-channel.js';
import AMQPView from './amqp-view.js';
/**
 * Base class for AMQPClients.
 * Implements everything except how to connect, send data and close the socket
 * @param vhost
 * @param username
 * @param password
 * @param name - name of the connection, set in client properties
 * @param platform - used in client properties
 */
export default abstract class AMQPBaseClient {
    vhost: string;
    username: string;
    password: string;
    name: string;
    platform: string;
    channels: AMQPChannel[];
    closed: boolean;
    channelMax: number;
    frameMax: number;
    heartbeat: number;
    blocked: string | null;
    closePromise: [
        resolve: (value: string) => void,
        reject: (value?: any) => void
    ];
    connectPromise: [
        resolve: (value: AMQPBaseClient | PromiseLike<AMQPBaseClient>) => void,
        reject: (value?: any) => void
    ];
    rejectPromise: (value?: any) => void;
    constructor(vhost: string, username: string, password: string, name: string, platform: string);
    /**
     * Open a channel
     * Optionally an existing or non existing channel id can be specified
     * @returns channel
     */
    channel(id?: number): Promise<AMQPChannel>;
    /**
     * Gracefully close the AMQP connection
     * @param params
     * @param params.code - Close code
     * @param params.reason - Reason for closing the connection
     */
    close({ code, reason }?: {
        code?: number;
        reason?: string;
    }): Promise<string>;
    abstract connect(): Promise<AMQPBaseClient>;
    abstract send(bytes: Uint8Array): Promise<any>;
    abstract closeSocket(): void;
    private rejectClosed;
    private rejectConnect;
    /**
     * Parse and act on frames in an AMQPView
     * @param view over a ArrayBuffer
     * @ignore
     */
    parseFrames(view: AMQPView): void;
}
//# sourceMappingURL=amqp-base-client.d.ts.map