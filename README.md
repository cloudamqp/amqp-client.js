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
import { AMQPClient } from '@cloudamqp/amqp-client'

async function run() {
  try {
    const amqp = new AMQPClient("amqp://localhost")
    const conn = await amqp.connect()
    const ch = await conn.channel()
    const q = await ch.queue()
    const consumer = await q.subscribe({noAck: true}, async (msg) => {
      console.log(msg.bodyToString())
      await consumer.cancel()
    })
    await q.publish("Hello World", {deliveryMode: 2})
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

## WebSockets

This library can be used in the browser to access an AMQP server over WebSockets. For servers such as RabbitMQ that doesn't (yet?) support WebSockets natively a [WebSocket TCP relay](https://github.com/cloudamqp/websocket-tcp-relay/) have to be used as a proxy. More information can be found [in this blog post](https://www.cloudamqp.com/blog/cloudamqp-releases-amqp-websockets.html).

For web browsers a [compiled](https://www.typescriptlang.org/) and [rolled up](https://www.rollupjs.org/) version is available at https://github.com/cloudamqp/amqp-client.js/releases.

Using AMQP over WebSockets in a browser:

```html
<!DOCTYPE html>
<html>
  <head>
    <script type=module>
      import { AMQPWebSocketClient } from './js/amqp-websocket-client.mjs'

      const textarea = document.getElementById("textarea")
      const input = document.getElementById("message")

      const tls = window.location.scheme === "https:"
      const url = `${tls ? "wss" : "ws"}://${window.location.host}`
      const amqp = new AMQPWebSocketClient(url, "/", "guest", "guest")

      async function start() {
        try {
          const conn = await amqp.connect()
          const ch = await conn.channel()
          attachPublish(ch)
          const q = await ch.queue("")
          await q.bind("amq.fanout")
          const consumer = await q.subscribe({noAck: false}, (msg) => {
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
            await ch.basicPublish("amq.fanout", "", input.value, { contentType: "text/plain" })
          } catch (err) {
            console.error("Error", err, "reconnecting in 1s")
            disablePublish()
            setTimeout(start, 1000)
          }
          input.value = ""
        }
      }

      function disablePublish() {
        document.forms[0].onsubmit = (e) => { alert("Disconnected, waiting to be reconnected") }
      }

      start()
    </script>
  </head>
  <body>
    <form>
      <textarea id="textarea" rows=10></textarea>
      <br/>
      <input id="message"/>
      <button type="submit">Send</button>
    </form>
  </body>
</html>
```

## Performance

Messages with a 1-byte body, no properties:

| Client | Publish rate | Consume rate |
| ------ | ------------ | ------------ |
| amqp-client.js | 300.000 msgs/s | 512.000 msgs/s |
| amqplib | 172.000 msgs/s | 519.000 msgs/s |

Messages with a 1-byte body, and all properties, except headers:

| Client | Publish rate | Consume rate |
| ------ | ------------ | ------------ |
| amqp-client.js | 144.000 msgs/s | 202.000 msgs/s |
| amqplib | 110.000 msgs/s | 251.000 msgs/s |

Messages with a 1-byte body, and all properties, including headers:

| Client | Publish rate | Consume rate |
| ------ | ------------ | ------------ |
| amqp-client.js | 70.000 msgs/s | 89.000 msgs/s |
| amqplib | 60.000 msgs/s | 99.000 msgs/s |

The reason amqp-client is somewhat slower to consume is that to maintain browser compatibility for the websocket client, [`DataView`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView) are used for parsing the binary protocol instead of [`Buffer`](https://nodejs.org/api/buffer.html).

Module comparison

| Client | Runtime dependencies | [Lines of code](https://github.com/AlDanial/cloc) |
| ------ | ------------ | --- |
| amqp-client.js | 0 | 1743 |
| amqplib | 14 | 6720 (w/o dependencies) |
