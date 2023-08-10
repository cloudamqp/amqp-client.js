import { AMQPClient } from "../lib/mjs/amqp-client.js"

async function run() {
  const amqp = new AMQPClient("amqp://localhost")
  const conn = await amqp.connect()
  let ch = await conn.channel()
  await ch.prefetch(100)
  let q = await ch.queue("stream1", {}, { "x-queue-type": "stream" })
  const consumer = await q.subscribe({ noAck: false, args: { "x-stream-offset": "first" } }, (msg) => {
    console.log(msg.bodyString())
    msg.ack()
  })
  await consumer.wait()
}
await run()
