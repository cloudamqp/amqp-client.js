import test from 'ava';
import { AMQPClient } from '../src/index.js';

test('can connect with TLS', t => {
  const amqp = new AMQPClient(process.env["AMQPS_URL"] || "amqps://127.0.0.1?insecure=true")
  return amqp.connect()
    .then(conn => conn.channel())
    .then(ch => t.is(ch.connection.channels.length, 2)) // 2 because channel 0 is counted
})
