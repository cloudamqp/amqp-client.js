import type { TlsOptions } from "tls"

/**
 * TLS options passed to `tls.createSecureContext`.
 *
 * - `cert` — Cert chains in PEM format. One cert chain per private key.
 * - `key` — Private keys in PEM format. Encrypted keys are decrypted with `passphrase`.
 * - `pfx` — PFX/PKCS12 encoded private key and certificate chain (alternative to key + cert).
 * - `passphrase` — Shared passphrase for a single private key and/or PFX.
 * - `ca` — Override trusted CA certificates (defaults to Mozilla's curated list).
 *
 * See https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions
 */
export type AMQPTlsOptions = Pick<TlsOptions, "key" | "cert" | "pfx" | "passphrase" | "ca">
