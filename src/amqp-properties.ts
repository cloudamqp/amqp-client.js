export type AMQPProperties = {
  contentType?: string
  contentEncoding?: string
  headers?: object
  deliveryMode?: number
  priority?: number
  correlationId?: string
  replyTo?: string
  expiration?: string
  messageId?: string
  timestamp?: Date
  type?: string
  userId?: string
  appId?: string
}
