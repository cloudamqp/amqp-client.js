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
    let i = 0
    const consumer = await q.subscribe({noAck: true}, (msg) => {
      console.log(msg.bodyString())
      setTimeout(() => q.publish(`hello world ${i}`), 1000)
      if (i == 3) consumer.cancel()
      i++
    })
    q.publish("first!")
    await consumer.wait() // will block until consumer is cancled or throw an error if server closed channel/connection
    conn.close()
  } catch (e) {
    console.error("ERROR", e)
    e.connection.close()
    setTimeout(run, 1000) // will try to reconnect in 1s
  }
}
run()
```
