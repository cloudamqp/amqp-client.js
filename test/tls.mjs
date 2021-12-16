import test from 'ava';
import AMQPClient from '../src/amqp-socket-client.mjs';

test('can open a connection and a channel', t => {
  const amqp = new AMQPClient("amqps://oslxoawx:tB7xysQkRuGo81-9HGRhOf3NXNrYAdkD@turkey.rmq.cloudamqp.com/oslxoawx")
  return amqp.connect()
    .then((conn) => conn.channel())
    .then((ch) => t.is(ch.connection.channels.length, 2)) // 2 because channel 0 is counted
})
