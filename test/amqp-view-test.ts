import test from 'ava';
import AMQPView from '../src/amqp-view.js';

test("setFrameEnd", async t => {
  const view = new AMQPView(new ArrayBuffer(30))
  t.is(view.setFrameEnd(0, true), 1)
})

test("setField with ArrayBuffer",  async t => {
  const view = new AMQPView(new ArrayBuffer(30))
  t.is(view.setField(0, new ArrayBuffer(1)), 6)
})

test("setField with bigint", async t => {
  const view = new AMQPView(new ArrayBuffer(30))
  t.is(view.setField(0, BigInt(123)), 9)
})
