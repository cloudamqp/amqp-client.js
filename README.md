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

Using AMQP in Node.js:

```javascript
import { AMQPClient } from "@cloudamqp/amqp-client"

async function run() {
  try {
    const amqp = new AMQPClient("amqp://localhost")
    const conn = await amqp.connect()
    const ch = await conn.channel()
    const q = await ch.queue()
    const consumer = await q.subscribe({ noAck: true }, async (msg) => {
      console.log(msg.bodyToString())
      await consumer.cancel()
    })
    await q.publish("Hello World", { deliveryMode: 2 })
    await consumer.wait() // will block until consumer is canceled or throw an error if server closed channel/connection
    await conn.close()
  } catch (e) {
    console.error("ERROR", e)
    e.connection.close()
    setTimeout(run, 1000) // will try to reconnect in 1s
  }
}

run()
```

### Using AsyncGenerator for consuming messages

As an alternative to the callback-based approach, you can use an AsyncGenerator for a more modern, iteration-based API:

```javascript
import { AMQPClient } from "@cloudamqp/amqp-client"

async function run() {
  try {
    const amqp = new AMQPClient("amqp://localhost")
    const conn = await amqp.connect()
    const ch = await conn.channel()
    const q = await ch.queue()

    await q.publish("Hello World", { deliveryMode: 2 })

    // Subscribe without a callback and use consumer.messages for AsyncGenerator
    const consumer = await q.subscribe({ noAck: false })
    for await (const msg of consumer.messages) {
      console.log(msg.bodyToString())
      await msg.ack()
      break // breaking automatically cancels the consumer
    }

    await conn.close()
  } catch (e) {
    console.error("ERROR", e)
    e.connection.close()
  }
}

run()
```

### Automatic Reconnection

Both `AMQPClient` and `AMQPWebSocketClient` support automatic reconnection with exponential backoff when the connection is lost. Configure reconnection via the constructor:

```javascript
import { AMQPClient } from "@cloudamqp/amqp-client"

async function run() {
  // Create a client with reconnection options
  const client = new AMQPClient(
    "amqp://localhost",
    undefined, // TLS options
    undefined, // logger
    {
      reconnectInterval: 1000,     // Initial delay before reconnecting (ms)
      maxReconnectInterval: 30000, // Maximum delay between attempts (ms)
      backoffMultiplier: 2,        // Exponential backoff multiplier
      maxRetries: 0,               // 0 = infinite retries
    }
  )

  // Set up event callbacks
  client.onconnect = () => console.log("Connected!")
  client.ondisconnect = (err) => console.log("Disconnected:", err?.message)
  client.onreconnecting = (attempt) => console.log("Reconnecting, attempt:", attempt)
  client.onfailed = (err) => console.log("Failed to reconnect:", err?.message)

  // Connect (will automatically reconnect on connection loss)
  await client.connect()

  // Open a channel and declare a queue
  const ch = await client.channel()
  const q = await ch.queue("my-queue", { durable: true })

  // Subscribe using the client's subscribe method for automatic consumer recovery
  await client.subscribe("my-queue", { noAck: false }, async (msg) => {
    console.log("Received:", msg.bodyString())
    await msg.ack()
  }, {
    prefetch: 10,  // Set prefetch limit for this consumer
    queueParams: { durable: true }  // Queue declaration parameters
  })

  // Publish messages
  await ch.basicPublish("", "my-queue", "Hello World")

  // When done, close the connection (this stops reconnection)
  // await client.close()
}

run()
```

#### Two APIs for Different Use Cases

This library provides two APIs that coexist:

1. **Low-level API** (unchanged): `client → channel → queue → subscribe`
   - Full control over channels and resources
   - No automatic reconnection - you handle connection failures
   - Use when you need fine-grained control

2. **High-level API** (new): `client.subscribe()`
   - Automatic reconnection and consumer recovery
   - Simplified API for common use cases
   - Use for convenience when you don't need channel-level control

#### Key Features

- **Automatic reconnection**: Reconnects automatically when the connection is lost
- **Exponential backoff**: Configurable delays between reconnection attempts
- **Consumer recovery**: Consumers registered via `client.subscribe()` are automatically re-established after reconnection
- **Event callbacks**: Hooks for connection state changes (`onconnect`, `ondisconnect`, `onreconnecting`, `onfailed`)
- **Prefetch control**: Set per-consumer prefetch limits

#### Reconnection Behavior

When a connection is lost:
- The client automatically attempts to reconnect using exponential backoff
- After successful reconnection, consumers created with `client.subscribe()` are automatically re-established
- Messages that were delivered but not acknowledged before disconnection will be redelivered by the broker (standard AMQP behavior)
- Any acknowledgment attempts during disconnection will fail and should be handled in your code

## WebSockets

This library can be used in the browser to access an AMQP server over WebSockets. For servers such as RabbitMQ that doesn't support WebSockets natively a [WebSocket TCP relay](https://github.com/cloudamqp/websocket-tcp-relay/) have to be used as a proxy. All CloudAMQP servers has this proxy configured. More information can be found [in this blog post](https://www.cloudamqp.com/blog/cloudamqp-releases-amqp-websockets.html).

For web browsers a [compiled](https://www.typescriptlang.org/) and [rolled up](https://www.rollupjs.org/) version is available at <https://github.com/cloudamqp/amqp-client.js/releases>.

Using AMQP over WebSockets in a browser:

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
          const q = await ch.queue("")
          await q.bind("amq.fanout")
          const consumer = await q.subscribe({ noAck: false }, (msg) => {
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
