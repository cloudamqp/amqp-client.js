# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `AMQPSession` — high-level client with automatic reconnection and consumer recovery ([#185](https://github.com/cloudamqp/amqp-client.js/pull/185), [#186](https://github.com/cloudamqp/amqp-client.js/pull/186))
  - `AMQPSession.connect(url, options?)` factory: picks TCP or WebSocket transport from the URL scheme (`amqp://` / `amqps://` → TCP; `ws://` / `wss://` → WebSocket)
  - Exponential backoff with configurable `reconnectInterval`, `maxReconnectInterval`, `backoffMultiplier`, and `maxRetries`
  - `session.queue(name, params?, args?)` — declare and return an `AMQPQueue` handle
  - `session.exchange(name, type, params?, args?)` — declare and return an `AMQPExchange` handle
  - Shorthand exchange factories: `directExchange()`, `fanoutExchange()`, `topicExchange()`, `headersExchange()`
  - `session.onconnect` / `session.onfailed` lifecycle hooks
  - `session.closed` — `true` when the underlying connection is closed
  - `session.stop()` — cancels reconnection, clears all subscriptions, and closes the connection
- `AMQPQueue` — reconnect-safe queue handle returned by `session.queue()`, with `publish()`, `subscribe()`, `get()`, `bind()`, `unbind()`, `purge()`, `delete()` ([#186](https://github.com/cloudamqp/amqp-client.js/pull/186))
  - `subscribe(callback)` / `subscribe(params, callback)` — auto-acks after the callback returns; nacks and requeues on throw; call `msg.ack()` / `msg.nack()` inside the callback to override; pass `{ noAck: true }` to skip acking entirely; `requeueOnNack` controls requeue behaviour on error ([#189](https://github.com/cloudamqp/amqp-client.js/pull/189))
  - `subscribe()` / `subscribe(params)` — async-iterator form; auto-acks the previous message when the loop advances; the last message (after `break`) is left unacked; call `msg.ack()` / `msg.nack()` before advancing to override; pass `{ noAck: true }` to skip acking ([#189](https://github.com/cloudamqp/amqp-client.js/pull/189))
  - Subscriptions survive reconnection automatically; the async-iterator form continues yielding without any caller changes
- `AMQPExchange` — reconnect-safe exchange handle returned by `session.exchange()`, with `publish()`, `bind()`, `unbind()`, `delete()` ([#186](https://github.com/cloudamqp/amqp-client.js/pull/186))
- `AMQPSubscription` — stable consumer handle across reconnections: exposes `channel`, `consumerTag`, and `cancel()`
- `AMQPGeneratorSubscription` — extends `AMQPSubscription` with `AsyncIterable<AMQPMessage>` support
- `QueueSubscribeParams` — exported type combining `ConsumeParams` with `prefetch?` and `requeueOnNack?` (default `true`) ([#189](https://github.com/cloudamqp/amqp-client.js/pull/189))
- `QueuePublishOptions` / `ExchangePublishOptions` — exported types for publish options; both extend `AMQPProperties` with a `confirm?` flag; `ExchangePublishOptions` adds `routingKey?`
- `ondisconnect` hook on `AMQPBaseClient` (TCP and WebSocket) — fires when the connection drops

### Changed

- **Breaking:** `AMQPChannel.queue()` removed ([#186](https://github.com/cloudamqp/amqp-client.js/pull/186)). Use `ch.queueDeclare()` with low-level channel methods, or `session.queue()` for the high-level API. See the migration guide below.
- **Breaking:** `AMQPQueue` is now a session-only class — no longer returned by channel methods, no longer accepts a channel in its constructor. ([#186](https://github.com/cloudamqp/amqp-client.js/pull/186))
- **Breaking:** `AMQPQueue` is no longer re-exported from `AMQPClient` or `AMQPWebSocketClient`. Import from the main package entry point instead. ([#186](https://github.com/cloudamqp/amqp-client.js/pull/186))

### Migration guide

The v3 `AMQPQueue` was tied to a single channel. In v4, `AMQPQueue` is a session-level handle that is reconnect-safe.

If you were using `ch.queue()`:

```diff
-const ch = await conn.channel()
-const q = await ch.queue("my-queue")
-await q.publish("hello")
-const consumer = await q.subscribe({ noAck: false }, (msg) => msg.ack())
-const msg = await q.get()
-await q.bind("amq.topic", "routing.key")
-await q.delete()

+// Low-level (no reconnection)
+const ch = await conn.channel()
+const { name } = await ch.queueDeclare("my-queue")
+await ch.basicPublish("", name, "hello")
+const consumer = await ch.basicConsume(name, { noAck: false }, (msg) => msg.ack())
+const msg = await ch.basicGet(name)
+await ch.queueBind(name, "amq.topic", "routing.key")
+await ch.queueDelete(name)

+// High-level (automatic reconnection)
+const session = await AMQPSession.connect("amqp://localhost")
+const q = await session.queue("my-queue")
+await q.publish("hello")
+const sub = await q.subscribe({ noAck: false }, (msg) => msg.ack())
+const msg = await q.get()
+await q.bind("amq.topic", "routing.key")
+await q.delete()
```

## [3.4.1] - 2025-11-28

### Fixed

- Improve 'republish in consume block' test reliability - add proper message acknowledgment and increase timeout for high-volume message processing

### Changed

- Make npm scripts cross-platform compatible ([#179](https://github.com/cloudamqp/amqp-client.js/pull/179))
- Update dependencies: glob 10.4.5→10.5.0, js-yaml 4.1.0→4.1.1 ([#173](https://github.com/cloudamqp/amqp-client.js/pull/173))
- Export AMQPGeneratorConsumer for documentation generation ([#172](https://github.com/cloudamqp/amqp-client.js/pull/172))

## [3.4.0] - 2025-11-12

### Added

- Add AsyncGenerator support to subscribe() for improved DX ([#169](https://github.com/cloudamqp/amqp-client.js/pull/169))

## [3.3.2] - 2025-09-12

### Fixed

- Improve connection loss handling for WebSocket connections ([#152](https://github.com/cloudamqp/amqp-client.js/pull/152))
- Fix parallel queue binding issues ([#154](https://github.com/cloudamqp/amqp-client.js/pull/154))
- Properly handle heartbeat timeouts ([#95](https://github.com/cloudamqp/amqp-client.js/pull/95))
- Fix TypeScript callback types to support async callbacks ([#155](https://github.com/cloudamqp/amqp-client.js/pull/155))
- Return publish frame buffer to pool after send ([#142](https://github.com/cloudamqp/amqp-client.js/pull/142))

### Changed

- Logger configuration improvements - console is no longer used as default logger, explicit logger parameter support added ([#149](https://github.com/cloudamqp/amqp-client.js/pull/149))
- Internal code improvements and optimizations ([#140](https://github.com/cloudamqp/amqp-client.js/pull/140))
- Add missing exports to WebSocket client ([#147](https://github.com/cloudamqp/amqp-client.js/pull/147))

## [3.3.0, 3.3.1]

- Fat fingers

## [3.2.1] - 2025-04-06

- Increase min `frameMax` to 8192 (8KB) for compatibility with RabbitMQ 4.1 and large JWT tokens ([#134](https://github.com/cloudamqp/amqp-client.js/pull/134))

## [3.2.0] - 2025-03-07

- Buffer all publish frames into a single huge buffer and send together
- Properly reject failed connection attempt
- TypeScript 5.7 fixes
- Web Worker compatibility

## [3.1.1] - 2023-08-25

- Correct version number in `src/amqp-base-client.ts`

## [3.1.0] - 2023-08-23

_The version number was not updated in `src/amqp-base-client.ts` for this release._

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
