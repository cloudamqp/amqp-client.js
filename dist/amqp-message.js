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
    constructor(channel) {
        this.channel = channel;
    }
    /**
     * Converts the message (which is deliviered as an uint8array) to a string
     * @return utf8 encoded string
     */
    bodyToString() {
        const decoder = new TextDecoder();
        return decoder.decode(this.body);
    }
    bodyString() {
        return this.bodyToString();
    }
    /** Acknowledge the message */
    ack(multiple = false) {
        return this.channel.basicAck(this.deliveryTag, multiple);
    }
    /** Negative acknowledgment (same as reject) */
    nack(requeue = false, multiple = false) {
        return this.channel.basicNack(this.deliveryTag, requeue, multiple);
    }
    /** Reject the message */
    reject(requeue = false) {
        return this.channel.basicReject(this.deliveryTag, requeue);
    }
}
