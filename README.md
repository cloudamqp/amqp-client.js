# amqp-client.js

AMQP 0-9-1 client both for Node.js and browsers (using WebSocket)

## Install

```
npm install @cloudamqp/amqp-client --save
```

## Example usage

```javascript
import AMQPClient from 'amqp-client'

async function run() {
  try {
    const amqp = new AMQPClient("amqp://localhost")
    const conn = await amqp.connect()
    const ch = await conn.channel()
    const q = await ch.queue()
    const consumer = await q.subscribe({noAck: true}, async (msg) => {
      console.log(msg.bodyString())
      await consumer.cancel()
    })
    await q.publish("Hello World")
    await consumer.wait() // will block until consumer is cancled or throw an error if server closed channel/connection
    await conn.close()
  } catch (e) {
    console.error("ERROR", e)
    e.connection.close()
    setTimeout(run, 1000) // will try to reconnect in 1s
  }
}

run()
```
