import { TlsOptions } from 'tls'

/** Additional TLS options, for more info check https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions 
 *  @cert Cert chains in PEM format. One cert chain should be provided per private key.
 *  @key Private keys in PEM format. PEM allows the option of private keys being encrypted.
 *        Encrypted keys will be decrypted with AMQPTlsOptions.passphrase.
 *  @pfx PFX or PKCS12 encoded private key and certificate chain.
 *       pfx is an alternative to providing key and cert individually.
 *       PFX is usually encrypted, if it is, passphrase will be used to decrypt it.
 *  @passphrase Shared passphrase used for a single private key and/or a PFX.
 *  @ca Optionally override the trusted CA certificates. Default is to trust the well-known CAs curated by Mozilla.
*/
export type AMQPTlsOptions = Pick<TlsOptions, "key" | "cert" | "pfx" | "passphrase" | "ca">;