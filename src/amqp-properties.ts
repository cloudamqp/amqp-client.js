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

type TlsOptionKeyType = string | string[] | Buffer | Buffer[]; 

/** Additional TLS options, for more info check https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions */
export type TlsOptions = {
  /** Cert chains in PEM format. One cert chain should be provided per private key. */
  cert?: TlsOptionKeyType;
  /** Private keys in PEM format. PEM allows the option of private keys being encrypted.
   *  Encrypted keys will be decrypted with options.passphrase. */
  key?: TlsOptionKeyType;
  /** PFX or PKCS12 encoded private key and certificate chain.
   *  pfx is an alternative to providing key and cert individually.
   *  PFX is usually encrypted, if it is, passphrase will be used to decrypt it.  */
  pfx?: TlsOptionKeyType;
  /** Shared passphrase used for a single private key and/or a PFX. */
  passphrase?: string;
  /** Optionally override the trusted CA certificates. Default is to trust the well-known CAs curated by Mozilla.  */
  ca?: TlsOptionKeyType
}