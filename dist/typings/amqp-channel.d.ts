import AMQPQueue from './amqp-queue.js';
import AMQPView from './amqp-view.js';
import AMQPConsumer from './amqp-consumer.js';
import AMQPBaseClient from './amqp-base-client.js';
import AMQPMessage, { AMQPReturnMessage } from './amqp-message.js';
import AMQPProperties from './protocol/amqp-properties.js';
/**
 * Represents an AMQP Channel. Almost all actions in AMQP are performed on a Channel.
 * @param connection - The connection this channel belongs to
 * @param id - ID of the channel
 */
export default class AMQPChannel {
    connection: AMQPBaseClient;
    id: number;
    consumers: Record<string | number, AMQPConsumer>;
    promises: [
        resolve: (value: any) => void,
        reject: (value?: any) => void
    ][];
    unconfirmedPublishes: any[];
    closed: boolean;
    confirmId?: number;
    delivery: AMQPMessage | null;
    getMessage: AMQPMessage | null;
    returned: AMQPReturnMessage | null;
    constructor(connection: AMQPBaseClient, id: number);
    /**
     * Declare a queue and return a AMQPQueue object.
     * @return Convient wrapper around a Queue object
     */
    queue(name?: string, props?: {}, args?: {}): Promise<AMQPQueue>;
    /**
     * Alias for basicQos
     */
    prefetch(prefetchCount: number): Promise<any>;
    /**
     * Default handler for Returned messages
     * @param message
     */
    onReturn(message: AMQPReturnMessage): void;
    /**
     * Close the channel gracefully
     * @param params
     * @param params.code - Close code
     * @param params.reason - Reason for closing the channel
     */
    close({ code, reason }?: {
        code?: number;
        reason?: string;
    }): Promise<string>;
    /**
     * Synchronously receive a message from a queue
     * @param queue - name of the queue to poll
     * @param param
     * @param param.noAck - if message is removed from the server upon delivery, or have to be acknowledged
     * @return - returns null if the queue is empty otherwise a single message
     */
    basicGet(queue: string, { noAck }?: {
        noAck?: boolean;
    }): Promise<AMQPMessage | null>;
    /**
     * Consume from a queue. Messages will be delivered asynchronously.
     * @param queue - name of the queue to poll
     * @param param
     * @param param.tag - tag of the consumer, will be server generated if left empty
     * @param param.noAck - if messages are removed from the server upon delivery, or have to be acknowledged
     * @param param.exclusive - if this can be the only consumer of the queue, will return an Error if there are other consumers to the queue already
     * @param param.args - custom arguments
     * @param callback - will be called for each message delivered to this consumer
     * @return
     */
    basicConsume(queue: string, { tag, noAck, exclusive, args }: {
        tag?: string;
        noAck?: boolean;
        exclusive?: boolean;
        args?: {};
    }, callback: (message: AMQPMessage) => void): Promise<AMQPConsumer>;
    /**
     * Cancel/stop a consumer
     * @param tag - consumer tag
     * @return
     */
    basicCancel(tag: string): Promise<AMQPChannel>;
    /**
     * Acknowledge a delivered message
     * @param deliveryTag - tag of the message
     * @param multiple - batch confirm all messages up to this delivery tag
     * @return
     */
    basicAck(deliveryTag: number, multiple?: boolean): Promise<any>;
    /**
     * Acknowledge a delivered message
     * @param deliveryTag - tag of the message
     * @param requeue - if the message should be requeued or removed
     * @param multiple - batch confirm all messages up to this delivery tag
     * @return
     */
    basicNack(deliveryTag: number, requeue?: boolean, multiple?: boolean): Promise<any>;
    /**
     * Acknowledge a delivered message
     * @param deliveryTag - tag of the message
     * @param requeue - if the message should be requeued or removed
     * @return
     */
    basicReject(deliveryTag: number, requeue?: boolean): Promise<any>;
    /**
     * Tell the server to redeliver all unacknowledged messages again, or reject and requeue them.
     * @param requeue - if the message should be requeued or redeliviered to this channel
     * @return
     */
    basicRecover(requeue?: boolean): Promise<any>;
    /**
     * Publish a message
     * @param exchange - the exchange to publish to, the exchange must exists
     * @param routingKey - routing key
     * @param data - the data to be published
     * @param properties - publish properties
     * @param mandatory - if the message should be returned if there's no queue to be delivered to
     * @param immediate - if the message should be returned if it can't be delivered to a consumer immediately (not supported in RabbitMQ)
     * @return  - fulfilled when the message is enqueue on the socket, or if publish confirm is enabled when the message is confirmed by the server
     */
    basicPublish(exchange: string, routingKey?: string, data?: string | Uint8Array | ArrayBuffer, properties?: AMQPProperties, mandatory?: boolean, immediate?: boolean): Promise<number>;
    /**
     * Set prefetch limit.
     * Recommended to set as each unacknowledge message will be store in memory of the client.
     * The server won't deliver more messages than the limit until messages are acknowledged.
     * @param prefetchCount - number of messages to limit to
     * @param prefetchSize - number of bytes to limit to (not supported by RabbitMQ)
     * @param global - if the prefetch is limited to the channel, or if false to each consumer
     * @return
     */
    basicQos(prefetchCount: number, prefetchSize?: number, global?: boolean): Promise<any>;
    /**
     * Enable or disable flow. Disabling flow will stop the server from delivering messages to consumers.
     * Not supported in RabbitMQ
     * @param active
     */
    basicFlow(active?: boolean): Promise<any>;
    /**
     * Enable publish confirm. The server will then confirm each publish with an Ack or Nack when the message is enqueued.
     * @return
     */
    confirmSelect(): Promise<any>;
    /**
     * Declare a queue
     * @param name - name of the queue, if empty the server will generate a name
     * @param params
     * @param {boolean} params.passive - if the queue name doesn't exists the channel will be closed with an error, fulfilled if the queue name does exists
     * @param {boolean} params.durable - if the queue should survive server restarts
     * @param {boolean} params.autoDelete - if the queue should be deleted when the last consumer of the queue disconnects
     * @param {boolean} params.exclusive - if the queue should be deleted when the channel is closed
     * @param args - optional custom queue arguments
     * @return fulfilled when confirmed by the server
     */
    queueDeclare(name?: string, { passive, durable, autoDelete, exclusive }?: {
        passive?: boolean;
        durable?: boolean;
        autoDelete?: boolean;
        exclusive?: boolean;
    }, args?: {}): Promise<{
        name: string;
        messages: number;
        consumers: number;
    }>;
    /**
     * Delete a queue
     * @param name - name of the queue, if empty it will delete the last declared queue
     * @param params
     * @param {boolean} params.ifUnused - only delete if the queue doesn't have any consumers
     * @param {boolean} params.ifEmpty - only delete if the queue is empty
     * @return
     */
    queueDelete(name?: string, { ifUnused, ifEmpty }?: {
        ifUnused?: boolean;
        ifEmpty?: boolean;
    }): Promise<{
        messageCount: number;
    }>;
    /**
     * Bind a queue to an exchange
     * @param queue - name of the queue
     * @param exchange - name of the exchange
     * @param routingKey - key to bind with
     * @param args - optional arguments, e.g. for header exchanges
     * @return fulfilled when confirmed by the server
     */
    queueBind(queue: string, exchange: string, routingKey: string, args?: {}): Promise<any>;
    /**
     * Unbind a queue from an exchange
     * @param queue - name of the queue
     * @param exchange - name of the exchange
     * @param routingKey - key that was bound
     * @param args - arguments, e.g. for header exchanges
     * @return fulfilled when confirmed by the server
     */
    queueUnbind(queue: string, exchange: string, routingKey: string, args?: {}): Promise<any>;
    /**
     * Purge a queue
     * @param queue - name of the queue
     * @return fulfilled when confirmed by the server
     */
    queuePurge(queue: string): Promise<any>;
    /**
     * Declare an exchange
     * @param name - name of the exchange
     * @param type - type of exchange (direct, fanout, topic, header, or a custom type)
     * @param param
     * @param {boolean} param.passive - if the exchange name doesn't exists the channel will be closed with an error, fulfilled if the exchange name does exists
     * @param {boolean} param.durable - if the exchange should survive server restarts
     * @param {boolean} param.autoDelete - if the exchange should be deleted when the last binding from it is deleted
     * @param {boolean} param.internal - if exchange is internal to the server. Client's can't publish to internal exchanges.
     * @param args - optional arguments
     * @return Fulfilled when the exchange is created or if it already exists
     */
    exchangeDeclare(name: string, type: string, { passive, durable, autoDelete, internal }?: {
        passive?: boolean;
        durable?: boolean;
        autoDelete?: boolean;
        internal?: boolean;
    }, args?: {}): Promise<any>;
    /**
     * Delete an exchange
     * @param name - name of the exchange
     * @param param
     * @param {boolean} param.ifUnused - only delete if the exchange doesn't have any bindings
     * @return Fulfilled when the exchange is deleted or if it's already deleted
     */
    exchangeDelete(name: string, { ifUnused }?: {
        ifUnused?: boolean;
    }): Promise<any>;
    /**
     * Exchange to exchange binding.
     * @param destination - name of the destination exchange
     * @param exchange - name of the source exchange
     * @param routingKey - key to bind with
     * @param args - optional arguments, e.g. for header exchanges
     * @return fulfilled when confirmed by the server
     */
    exchangeBind(destination: string, source: string, routingKey?: string, args?: {}): Promise<any>;
    /**
     * Delete an exchange-to-exchange binding
     * @param queue - name of the queue
     * @param exchange - name of the exchange
     * @param routingKey - key that was bound
     * @param args - arguments, e.g. for header exchanges
     * @return fulfilled when confirmed by the server
     */
    exchangeUnbind(destination: string, source: string, routingKey?: string, args?: {}): Promise<any>;
    /**
     * Set this channel in Transaction mode.
     * Rember to commit the transaction, overwise the server will eventually run out of memory.
     */
    txSelect(): Promise<any>;
    /**
     * Commit a transaction
     */
    txCommit(): Promise<any>;
    /**
     * Rollback a transaction
     */
    txRollback(): Promise<any>;
    private txMethod;
    /**
     * Resolves the next RPC promise
     * @ignore
     * @return true if a promise was resolved, otherwise false
     */
    resolvePromise(value: string | boolean | AMQPChannel | AMQPMessage | Record<string, string | number>): boolean;
    /**
     * Rejects the next RPC promise
     * @ignore
     * @return true if a promise was rejected, otherwise false
     */
    rejectPromise(err: any): boolean;
    /**
     * Send a RPC request, will resolve a RPC promise when RPC response arrives
     * @ignore
     * @param frame with data
     * @param frameSize how long the frame actually is
     */
    sendRpc(frame: AMQPView, frameSize: number): Promise<any>;
    /**
     * Marks the channel as closed
     * All outstanding RPC requests will be rejected
     * All outstanding publish confirms will be rejected
     * All consumers will be marked as closed
     * @ignore
     * @param err - why the channel was closed
     * @protected
     */
    setClosed(err: any): void;
    /**
     * @ignore
     * @return Rejected promise with an error
     */
    rejectClosed(): Promise<any>;
    /**
     * Called from AMQPBaseClient when a publish is confirmed by the server.
     * Will fulfill one or more (if multiple) Unconfirmed Publishes.
     * @ignore
     * @param deliveryTag
     * @param multiple - true if all unconfirmed publishes up to this deliveryTag should be resolved or just this one
     * @param nack - true if negative confirm, hence reject the unconfirmed publish(es)
     */
    publishConfirmed(deliveryTag: number, multiple: boolean, nack: boolean): void;
    /**
     * Called from AMQPBaseClient when a message is ready
     * @ignore
     */
    onMessageReady(message: AMQPMessage | AMQPReturnMessage): void;
    /**
     * Deliver a message to a consumer
     * @ignore
     * @param {AMQPMessage} message
     */
    deliver(message: AMQPMessage): void;
}
//# sourceMappingURL=amqp-channel.d.ts.map