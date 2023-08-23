# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2023-08-23

## Added

- Support for clients to negotiate channel-max ([#86](https://github.com/cloudamqp/amqp-client.js/pull/86))
- Raise when WebSocket is not cleanly closed ([#80](https://github.com/cloudamqp/amqp-client.js/pull/80))
- Make logging configurable ([#79](https://github.com/cloudamqp/amqp-client.js/pull/79))
- Support for connection.update-secret ([#77](https://github.com/cloudamqp/amqp-client.js/pull/77))

## Fixed

- Channel max 0 should be treated as "unlimited" not 0 ([#86](https://github.com/cloudamqp/amqp-client.js/pull/86))
- Close sockets not supporting amqp protocol ([#78](https://github.com/cloudamqp/amqp-client.js/pull/78))

## Changed

- Throws and rejects with `Error` as per best practice ([#81](https://github.com/cloudamqp/amqp-client.js/pull/81))
- Clean ups ([#88](https://github.com/cloudamqp/amqp-client.js/pull/88), [#85](https://github.com/cloudamqp/amqp-client.js/pull/85))
- Package improvements for bundling and tree-shaking ([#75](https://github.com/cloudamqp/amqp-client.js/pull/75))

## [3.0.0] - 2023-07-24

### Added

- New overload for `AMQPWebSocketClient` constructor to allow setting optional parameters through an init object ([#71](https://github.com/cloudamqp/amqp-client.js/issues/71))

### Fixed

- Call socket.destroy() when closing socket to fix intermitent condition where onerror is called when conn is closed by client ([#72](https://github.com/cloudamqp/amqp-client.js/issues/72))
- Pass the correct array buffer to dataview when reading framesize (related to [#55](https://github.com/cloudamqp/amqp-client.js/issues/55))
- Raise `AMQPError` when `channelMax` is reached (fixes [#43](https://github.com/cloudamqp/amqp-client.js/issues/43))
- Add `Channel#onerror` callback (fixes [#40](https://github.com/cloudamqp/amqp-client.js/issues/40))
- Correctly handle frame headers split across reads in the WebSocket client ([#68](https://github.com/cloudamqp/amqp-client.js/issues/68), fixes [#55](https://github.com/cloudamqp/amqp-client.js/issues/55))

### Changed

- Breaking change: Removed support for end-of-life versions of Node.js. A minimum of Node.js 16 is now required. ([#70](https://github.com/cloudamqp/amqp-client.js/pull/70))

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
