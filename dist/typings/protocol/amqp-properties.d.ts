/** AMQPMessage properties. */
export default interface AMQPProperties {
    contentType?: string;
    /**
     * eg. gzip
     */
    contentEncoding?: string;
    /**
     * custom headers, can also be used for routing with header exchanges
     */
    headers?: Record<string, unknown>;
    /**
     * 1 for transient, 2 for persisent
     */
    deliveryMode?: number;
    /**
     * between 0 and 255
     */
    priority?: number;
    /**
     * for RPC requests
     */
    correlationId?: string;
    /**
     * for RPC requests
     */
    replyTo?: string;
    /**
     * number in milliseconds, as string
     */
    expiration?: string;
    /**
     */
    messageId?: string;
    /**
     * the time the message was generated
     */
    timestamp?: Date;
    /** */
    type?: string;
    /** */
    userId?: string;
    /** */
    appId?: string;
}
//# sourceMappingURL=amqp-properties.d.ts.map