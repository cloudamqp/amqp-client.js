import { expect, test, beforeEach } from "vitest";
import { AMQPClient } from "../src/amqp-socket-client.js";
import { randomBytes } from "crypto";

beforeEach(() => {
  expect.hasAssertions();
});

test("can connect with TLS", () => {
  const amqp = new AMQPClient(
    process.env["AMQPS_URL"] || "amqps://127.0.0.1?insecure=true",
  );
  return amqp
    .connect()
    .then((conn) => conn.channel())
    .then((ch) => expect(ch.connection.channels.length).toBe(2)); // 2 because channel 0 is counted
});

test("can batch send message", async () => {
  const messages = [
    randomBytes(500),
    randomBytes(500),
    randomBytes(500),
    randomBytes(500),
  ];
  const amqp = new AMQPClient("amqps://localhost?insecure=1");
  const connection = await amqp.connect();
  const channel = await connection.channel();
  const queue = await channel.queue("bug137");
  await channel.confirmSelect();
  const sendMsgs = messages.map((message) =>
    queue.publish(JSON.stringify(message), {
      contentType: "application/json",
      deliveryMode: 2,
    }),
  );

  expect(connection["bufferPool"].length).toBe(0);
  await Promise.all(sendMsgs);
  expect(connection["bufferPool"].length).toBe(4);
});
