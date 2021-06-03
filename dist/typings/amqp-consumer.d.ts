import AMQPChannel from './amqp-channel.js';
import AMQPMessage from './amqp-message.js';
/**
 * A consumer, subscribed to a queue
 */
export default class AMQPConsumer {
    channel: AMQPChannel;
    tag: string;
    onMessage: (message: AMQPMessage) => void;
    private closed;
    private closedError;
    private resolveWait;
    private rejectWait;
    private timeoutId;
    /**
     * @param channel - the consumer is created on
     * @param tag - consumer tag
     * @param onMessage - callback executed when a message arrive
     */
    constructor(channel: AMQPChannel, tag: string, onMessage: (message: AMQPMessage) => void);
    /**
     * Wait for the consumer to finish.
     * @param timeout wait for this many milliseconds and then return regardless
     * @return  - Fulfilled when the consumer/channel/connection is closed by the client. Rejected if the timeout is hit.
     */
    wait(timeout?: number): Promise<any>;
    /**
     * Cancel/abort/stop the consumer. No more messages will be deliviered to the consumer.
     * Note that any unacked messages are still unacked as they belong to the channel and not the consumer.
     */
    cancel(): Promise<AMQPChannel>;
    setClosed(err: any): void;
}
//# sourceMappingURL=amqp-consumer.d.ts.map