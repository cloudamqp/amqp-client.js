import type { AMQPCodecRegistry } from "./amqp-codec-registry.js"
import type { AMQPMessage } from "./amqp-message.js"

/**
 * Decode and set the message body using the codec registry.
 * Mutates the message in place.
 * @internal
 */
export async function decodeMessage(msg: AMQPMessage, codecs: AMQPCodecRegistry): Promise<AMQPMessage> {
  if (msg.body) {
    const decoded = await codecs.decodeAndParse(msg.body, msg.properties)
    msg.setDecodedBody(decoded)
  }
  return msg
}
