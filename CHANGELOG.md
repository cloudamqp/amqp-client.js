# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
