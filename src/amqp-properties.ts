export type AMQPProperties = {
  /** content type of body, eg. application/json */
  contentType?: string
  /** content encoding of body, eg. gzip */
  contentEncoding?: string
  /** custom headers, can also be used for routing with header exchanges */
  headers?: Record<string, Field>
  /** 1 for transient messages, 2 for persistent messages */
  deliveryMode?: number
  /** between 0 and 255 */
  priority?: number
  /** for RPC requests */
  correlationId?: string
  /** for RPC requests */
  replyTo?: string
  /** Message TTL, in milliseconds, as string */
  expiration?: string
  messageId?: string
  /** the time the message was generated */
  timestamp?: Date
  type?: string
  userId?: string
  appId?: string
}

export type Field = string | boolean | bigint | number | undefined | null | object;
