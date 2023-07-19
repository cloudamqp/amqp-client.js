# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

#### Fixed

- Call socket.destroy() when closing socket to fix intermitent condition where onerror is called when conn is closed by client.

### Changed

- Breaking change: Removed support for end-of-life versions of Node.js. A minimum of Node.js 16 is now required.

## [2.1.1] - 2022-12-13

### Added

- Custom TlsOptions can be passed to the constructor, like: `new AMQPClient(url, { cert, "", key: "", ca: "" })`

## [2.1.0] - 2022-03-07

### Added

- AMQPClient#onerror, will be called whenever ther connection is closed, override it to create reconnect logic.
- Export types for queue, exchange and consume parameters

### Fixed

- Only skip TLS certificate validation if the `insecure` query parameter is included in the URL
- Use a pool of buffers so that multiple microtasks can publish simultaneously
- Don't set an IP as SNI hostname, only proper hostnames
- Decode username/password in URL properly

### Changed

- Allow publishing of `null` and let AMQPMessage#body be null when a body is missing

## [2.0.3] - 2022-03-07

### Fixed

- Heartbeat support
- Channel#closed is now a public property

## [2.0.2] - 2022-03-04

### Fixed

- Frame errors because frame buffer was reused

## [2.0.1] - 2022-03-04

### Fixed

- Frame errors because frame buffer was reused

### Changed

- Don't depend on TextEncoder in AMQPMessage

### Added

- Explicit return types on all methods for faster typescript compilation

## [2.0.0] - 2022-02-02

### Changed

- No default exports, only named: `import { AMQPClient } from "@cloudamqp/amqp-client"`
- Much improved browser bundling support (webpack)

### Added

- Support basicCancel send from server, AMQPConsumer#wait() will throw an Error if it happens.
- Support custom frameMax values, by URL: amqp://localhost/vhost?frameMax=8192

## [1.3.2] - 2022-01-12

### Fixed

- Websocket client now supports parsing AMQP frames split over multiple WebSocket frames (could happen with high throughput via websocket-tcp-relay).

### Changed

- 67% increased publish rate, by reusing frame buffer

## [1.3.1] - 2022-01-03

### Changed

- Use Buffer for string encoding/decoding for >100% performance boost
- Use 4096 frameMax for smaller and faster allocations (down from 16KB)
- Reraise RangeErrors with more debug information

## [1.3.0] - 2021-12-23

### Changed

- Rewrite in TypeScript

### Fixed

- Queue purged never resolved

### Added

- Logging when connection is blocked/unblocked by server

## [1.2.2] - 2021-12-21

### Fixed

- tls/net.socket onread is buggy in nodejs 16, revert to 'data' event for parsing frames

### Changed

- nodejs version expanded to 12

## [1.2.1] - 2021-12-20

### Changed

- 128KB read buffer
- Avoid copying frame when whole frame is included in one read
- Static textdecoder for faster string decoding in frames

### Fixed

- Error if a frame was split before the first 7 bytes between two reads

## [1.2.0] - 2021-12-16

### Changed

- tls connections require node 14 due to tls.connect({ onread })

### Added

- Typescript defintions through jsdoc comments
