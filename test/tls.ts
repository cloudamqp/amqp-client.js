import { expect, test, beforeEach } from "vitest";
import { AMQPClient } from '../src/amqp-socket-client.js';

beforeEach(() => {
  expect.hasAssertions()
})

test('can connect with TLS', () => {
  const amqp = new AMQPClient(process.env["AMQPS_URL"] || "amqps://127.0.0.1?insecure=true")
  return amqp.connect()
    .then(conn => conn.channel())
    .then(ch => expect(ch.connection.channels.length).toBe(2)) // 2 because channel 0 is counted
})
