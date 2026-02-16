// Type declarations for optional compression peer dependencies

declare module "lz4-napi" {
  export function compress(data: Buffer): Promise<Buffer>
  export function compressSync(data: Buffer): Buffer
  export function uncompress(data: Buffer): Promise<Buffer>
  export function uncompressSync(data: Buffer): Buffer
}

declare module "snappy" {
  export function compress(data: Uint8Array | Buffer): Promise<Buffer>
  export function compressSync(data: Uint8Array | Buffer): Buffer
  export function uncompress(data: Uint8Array | Buffer): Promise<Buffer>
  export function uncompressSync(data: Uint8Array | Buffer): Buffer
}

declare module "@mongodb-js/zstd" {
  export function compress(data: Buffer): Promise<Buffer>
  export function decompress(data: Buffer): Promise<Buffer>
}

declare module "pako" {
  export function gzip(data: Uint8Array): Uint8Array
  export function ungzip(data: Uint8Array): Uint8Array
}
