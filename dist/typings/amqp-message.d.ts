import AMQPChannel from "./amqp-channel.js";
import AMQPProperties from "./protocol/amqp-properties.js";
/**
 * AMQP return message
 * @property {Uint8array} body - The raw message body
 * @property {number} replyCode - The raw message body
 * @property {string} replyText - The raw message body
 * @property {string} exchange - The exchange the message was published to
 * @property {string} routingKey - The routing key the message was published with
 * @property {number} bodySize - The size of the body.
 * @property {AMQPProperties} properties - The properties the message was published with.
 */
export interface AMQPReturnMessage {
    replyCode: number;
    replyText: string;
    exchange: string;
    routingKey: string;
    bodyPos?: number;
    bodySize?: number;
    body?: Uint8Array;
    properties?: AMQPProperties;
}
/**
 * AMQP message
 * @param channel - Channel this message was delivered on
 * @property {Uint8array} body - The raw message body
 * @property {number} deliveryTag - The deliveryTag of this message
 * @property {boolean} redelivered - If the message has already been delivered once
 * @property {string} consumerTag - The tag of the consumer that got the message
 * @property {string} exchange - The exchange the message was published to
 * @property {string} routingKey - The routing key the message was published with
 * @property {number} messageCount - The number of messages in the queue
 * @property {number} bodySize - The size of the body.
 * @property {AMQPProperties} properties - The properties the message was published with.
 *
 */
export default class AMQPMessage {
    private channel;
    deliveryTag: number;
    redelivered: boolean;
    consumerTag: string;
    exchange: string;
    routingKey: string;
    messageCount: number;
    body: Uint8Array;
    bodyPos: number;
    bodySize: number;
    properties: AMQPProperties;
    constructor(channel: AMQPChannel);
    /**
     * Converts the message (which is deliviered as an uint8array) to a string
     * @return utf8 encoded string
     */
    bodyToString(): string;
    bodyString(): string;
    /** Acknowledge the message */
    ack(multiple?: boolean): Promise<any>;
    /** Negative acknowledgment (same as reject) */
    nack(requeue?: boolean, multiple?: boolean): Promise<any>;
    /** Reject the message */
    reject(requeue?: boolean): Promise<any>;
}
//# sourceMappingURL=amqp-message.d.ts.map