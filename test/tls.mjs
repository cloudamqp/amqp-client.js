import test from 'ava';
import process from 'process';
import AMQPClient from '../src/amqp-socket-client.mjs';

test('can connect with TLS', t => {
  const amqp = new AMQPClient(process.env.AMQPS_URL || "amqps://localhost")
  return amqp.connect()
    .then(conn => conn.channel())
    .then(ch => t.is(ch.connection.channels.length, 2)) // 2 because channel 0 is counted
})
