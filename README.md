# amqp-client.js

AMQP 0-9-1 TypeScript client both for Node.js and browsers (using WebSocket). This library is intended to replace all other Node.js AMQP libraries.

[API documentation](https://cloudamqp.github.io/amqp-client.js/).

This library is Promise-based and hence works very well with async/await. It's secure by default, for instance, publishes aren't fulfilled until either the data has been sent on the wire (so that back propagation is respected), or if the channel has Publish Confirms enabled, it isn't fulfilled until the server has acknowledged that the message has been enqueued.

The library was developed so to make it easy for developers who already are familiar with AMQP to write browser apps that communicates directly with an AMQP server over WebSocket.

## Support

The library is developed and supported by [CloudAMQP](https://www.cloudamqp.com), the largest hosted RabbitMQ provider in the world.

## Install

```shell
npm install @cloudamqp/amqp-client --save
```

Start node with `--enable-source-maps` to get proper stacktraces as the library is transpiled from TypeScript.

## Example usage

This library provides two APIs:

- **High-level** (`AMQPSession`): automatic reconnection, consumer recovery — use `queue()` / `exchange()` handles for reconnect-safe operations
- **Low-level** (`AMQPClient` / `AMQPWebSocketClient`): direct channel access with `queueDeclare`, `basicPublish`, `basicConsume`, etc.

### High-level API (recommended)

Use `AMQPSession.connect(url, options)` to get a session with automatic reconnection and consumer recovery. The transport is chosen from the URL scheme (`amqp://` / `amqps://` → TCP; `ws://` / `wss://` → WebSocket):

```javascript
import { AMQPSession } from "@cloudamqp/amqp-client"

const session = await AMQPSession.connect("amqp://localhost")

// Declare a queue and publish a message (waits for broker confirmation)
const q = await session.queue("my-queue")
await q.publish("Hello World", { deliveryMode: 2 })

// Subscribe with a callback — consumer recovers automatically on reconnect.
// Messages are acked after the callback returns. If it throws, the message is
// nacked and requeued. Call msg.ack() / msg.nack() yourself to override.
const sub = await q.subscribe(async (msg) => {
  console.log(msg.bodyString())
})

// Or subscribe with an async iterator — messages are acked when the loop advances.
// Call msg.ack() / msg.nack() before the next iteration to override.
const iterSub = await q.subscribe()
for await (const msg of iterSub) {
  console.log(msg.bodyString())
}

// Exchanges work the same way
const x = await session.topicExchange("events")
await x.publish("user signed up", { routingKey: "events.user.created" })

// When done
await session.stop()
```

#### Reconnection options

```javascript
const session = await AMQPSession.connect("amqp://localhost", {
  reconnectInterval: 1000, // initial delay before reconnecting (ms)
  maxReconnectInterval: 30000, // maximum delay between attempts (ms)
  backoffMultiplier: 2, // exponential backoff multiplier
  maxRetries: 0, // 0 = infinite retries
})

session.onconnect = () => console.log("Reconnected!")
session.onfailed = (err) => console.error("Gave up:", err?.message)
```

#### Consumer recovery

Subscriptions created via `queue.subscribe()` are automatically re-established after reconnection. Include `prefetch` in the subscribe params to set QoS on each connection:

```javascript
const q = await session.queue("my-queue", { durable: true })
const sub = await q.subscribe({ prefetch: 10 }, async (msg) => {
  // process msg — acked on return, nacked and requeued on throw
})

// sub.consumerTag and sub.channel reflect the current consumer (updated on reconnect)
// await sub.cancel()  // stops consuming and removes from auto-recovery
```

#### RPC (Remote Procedure Call)

The session provides built-in RPC support using the direct reply-to feature:

```javascript
import { AMQPSession } from "@cloudamqp/amqp-client"

const session = await AMQPSession.connect("amqp://localhost")

// Start an RPC server that listens on a queue
const server = await session.rpcServer("my_rpc_queue", async (msg) => {
  return `processed:${msg.bodyString()}`
})

// Simple RPC call — creates a temporary client per call
const reply = await session.rpcCall("my_rpc_queue", "hello", { timeout: 5000 })
console.log(reply.bodyToString()) // "processed:hello"

// For high-throughput scenarios, reuse a client to avoid per-call channel overhead
const rpc = await session.rpcClient()
const r1 = await rpc.call("my_rpc_queue", "a")
const r2 = await rpc.call("my_rpc_queue", "b")
await rpc.close()

await session.stop() // closes all RPC clients, servers, and consumers
```

RPC servers and reusable clients created via `session.rpcClient()` are automatically recovered after a reconnection.

### Low-level API

For full control over channels and resources, use the transport clients directly:

```javascript
import { AMQPClient } from "@cloudamqp/amqp-client"

const amqp = new AMQPClient("amqp://localhost")
const conn = await amqp.connect()
const ch = await conn.channel()

// Declare a queue
const q = await ch.queueDeclare("my-queue")

// Publish
await ch.basicPublish("", q.name, "Hello World", { deliveryMode: 2 })

// Consume with a callback
const consumer = await ch.basicConsume(q.name, { noAck: false }, async (msg) => {
  console.log(msg.bodyToString())
  await msg.ack()
  await consumer.cancel()
})
await consumer.wait()

// Or consume with an async iterator
const consumer = await ch.basicConsume(q.name, { noAck: false })
for await (const msg of consumer.messages) {
  console.log(msg.bodyToString())
  await msg.ack()
  break // breaking automatically cancels the consumer
}

await conn.close()
```

## WebSockets

This library can be used in the browser to access an AMQP server over WebSockets. For servers such as RabbitMQ that doesn't support WebSockets natively a [WebSocket TCP relay](https://github.com/cloudamqp/websocket-tcp-relay/) have to be used as a proxy. All CloudAMQP servers has this proxy configured. More information can be found [in this blog post](https://www.cloudamqp.com/blog/cloudamqp-releases-amqp-websockets.html).

For web browsers a [compiled](https://www.typescriptlang.org/) and [rolled up](https://www.rollupjs.org/) version is available at <https://github.com/cloudamqp/amqp-client.js/releases>.

`AMQPSession` works with WebSocket URLs out of the box — pass a `ws://` or `wss://` URL and transport is chosen automatically:

```javascript
import { AMQPSession } from "@cloudamqp/amqp-client"

const session = await AMQPSession.connect("wss://my.cloudamqp.com/ws/", {
  vhost: "my-vhost",
})
const q = await session.queue("my-queue")
const sub = await q.subscribe({ noAck: true }, (msg) => {
  console.log(msg.bodyString())
})
```

For lower-level control without reconnection, use `AMQPWebSocketClient` directly:

```html
<!DOCTYPE html>
<html>
  <head>
    <script type="module">
      import { AMQPWebSocketClient } from "./js/amqp-websocket-client.mjs"

      const textarea = document.getElementById("textarea")
      const input = document.getElementById("message")

      const tls = window.location.protocol === "https:"
      const url = `${tls ? "wss" : "ws"}://${window.location.host}`
      const amqp = new AMQPWebSocketClient(url, "/", "guest", "guest")

      async function start() {
        try {
          const conn = await amqp.connect()
          const ch = await conn.channel()
          attachPublish(ch)
          const q = await ch.queueDeclare("")
          await ch.queueBind(q.name, "amq.fanout", "")
          const consumer = await ch.basicConsume(q.name, { noAck: false }, (msg) => {
            console.log(msg)
            textarea.value += msg.bodyToString() + "\n"
            msg.ack()
          })
        } catch (err) {
          console.error("Error", err, "reconnecting in 1s")
          disablePublish()
          setTimeout(start, 1000)
        }
      }

      function attachPublish(ch) {
        document.forms[0].onsubmit = async (e) => {
          e.preventDefault()
          try {
            await ch.basicPublish("amq.fanout", "", input.value, {
              contentType: "text/plain",
            })
          } catch (err) {
            console.error("Error", err, "reconnecting in 1s")
            disablePublish()
            setTimeout(start, 1000)
          }
          input.value = ""
        }
      }

      function disablePublish() {
        document.forms[0].onsubmit = (e) => {
          alert("Disconnected, waiting to be reconnected")
        }
      }

      start()
    </script>
  </head>
  <body>
    <form>
      <textarea id="textarea" rows="10"></textarea>
      <br />
      <input id="message" />
      <button type="submit">Send</button>
    </form>
  </body>
</html>
```

## Performance

Messages with a 1-byte body, no properties:

| Client         | Publish rate   | Consume rate   |
| -------------- | -------------- | -------------- |
| amqp-client.js | 300.000 msgs/s | 512.000 msgs/s |
| amqplib        | 172.000 msgs/s | 519.000 msgs/s |

Messages with a 1-byte body, and all properties, except headers:

| Client         | Publish rate   | Consume rate   |
| -------------- | -------------- | -------------- |
| amqp-client.js | 144.000 msgs/s | 202.000 msgs/s |
| amqplib        | 110.000 msgs/s | 251.000 msgs/s |

Messages with a 1-byte body, and all properties, including headers:

| Client         | Publish rate  | Consume rate  |
| -------------- | ------------- | ------------- |
| amqp-client.js | 70.000 msgs/s | 89.000 msgs/s |
| amqplib        | 60.000 msgs/s | 99.000 msgs/s |

The reason amqp-client is somewhat slower to consume is that to maintain browser compatibility for the websocket client, [`DataView`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView) are used for parsing the binary protocol instead of [`Buffer`](https://nodejs.org/api/buffer.html).

Module comparison

| Client         | Runtime dependencies | [Lines of code](https://github.com/AlDanial/cloc) |
| -------------- | -------------------- | ------------------------------------------------- |
| amqp-client.js | 0                    | 1743                                              |
| amqplib        | 14                   | 6720 (w/o dependencies)                           |

## Release

This project uses automated release scripts for version management.

### Release Commands

The package.json includes several npm scripts for releasing:

- **`npm run release`** - Performs a patch version bump (e.g., 3.2.1 → 3.2.2) and creates a release
- **`npm run release:minor`** - Performs a minor version bump (e.g., 3.2.1 → 3.3.0) and creates a release
- **`npm run release:major`** - Performs a major version bump (e.g., 3.2.1 → 4.0.0) and creates a release

### What happens during a release

1. **Tests**: All tests are run to ensure everything passes (`preversion`)
2. **Version bump**: npm automatically updates the version in `package.json`
3. **File updates**: The version is updated in `src/amqp-base-client.ts`, code is formatted, and changelog is updated (`version`)
4. **Staging**: All changes are staged for commit (`version`)
5. **Git commit**: npm automatically commits all staged changes with a version message
6. **Git tag**: An annotated tag is created with the full changelog content as the tag message (`postversion`)
7. **Push**: Both the commit and tags are pushed to the remote repository (`postversion`)
8. **CI deployment**: The GitHub Actions workflow automatically publishes the new version to npm

> **Technical Note**: This release process leverages npm's built-in version lifecycle hooks (`preversion`, `version`, `postversion`). The `npm version` command automatically handles the git commit after running our custom `version` script, which is why we stage changes with `git add -A` rather than committing manually.

### Prerequisites

Before releasing:

1. Add your changes to the `## [Unreleased]` section in `CHANGELOG.md`
2. All tests should pass (`npm test`)
3. The working directory should be clean (no uncommitted changes)

### Automated npm Publishing

When a new tag is pushed (e.g., `v3.3.0`), the GitHub Actions workflow (`.github/workflows/release.yml`) automatically:

- Builds the project
- Publishes the package to npm with public access and provenance
- Creates a GitHub release with browser bundle artifacts

The git tag contains the complete changelog section for that version, including version header, all changes, and PR links. This makes it easy to see what changed in each release directly from the git tag.
