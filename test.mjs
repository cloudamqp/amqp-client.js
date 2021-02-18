import test from 'ava';
import AMQPClient from './amqpclient.mjs';

test('can open a connection and a channel', t => {
  const amqp = new AMQPClient("amqp://")
  return amqp.connect()
    .then((conn) => conn.openChannel())
    .then((ch) => t.is(ch.connection.channels.length, 2)) // 2 because channel 0 is counted
});
