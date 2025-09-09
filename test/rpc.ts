import { expect, test, beforeEach } from "vitest";
import { AMQPClient } from '../src/amqp-socket-client.js';
import { AMQPRpcClient } from '../src/amqp-rpc-client.js';
import { AMQPRpcServer } from '../src/amqp-rpc-server.js';

function getNewClient(): AMQPClient {
  return new AMQPClient("amqp://127.0.0.1")
}

beforeEach(() => {
  expect.hasAssertions()
})

test('RPC client can make a simple call', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  
  // Set up RPC server
  const server = new AMQPRpcServer(ch, 'test-rpc-queue')
  server.register('add', (params) => {
    return params.a + params.b
  })
  await server.start()
  
  // Set up RPC client
  const client = new AMQPRpcClient(ch, 'test-rpc-queue')
  
  try {
    // Make RPC call
    const result = await client.call('add', { a: 5, b: 3 })
    expect(result).toBe(8)
  } finally {
    await client.close()
    await server.stop()
    await conn.close()
  }
})

test('RPC server handles unknown method gracefully', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  
  // Set up RPC server with no registered methods
  const server = new AMQPRpcServer(ch, 'test-rpc-queue-2')
  await server.start()
  
  // Set up RPC client
  const client = new AMQPRpcClient(ch, 'test-rpc-queue-2')
  
  try {
    // Make RPC call to unknown method
    await expect(client.call('unknown-method', {})).rejects.toThrow('Unknown RPC method: unknown-method')
  } finally {
    await client.close()
    await server.stop()
    await conn.close()
  }
})

test('RPC client handles timeout correctly', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  
  // Set up RPC server with slow handler
  const server = new AMQPRpcServer(ch, 'test-rpc-queue-3')
  server.register('slow-method', async () => {
    // Simulate slow processing
    await new Promise(resolve => setTimeout(resolve, 2000))
    return 'done'
  })
  await server.start()
  
  // Set up RPC client
  const client = new AMQPRpcClient(ch, 'test-rpc-queue-3')
  
  try {
    // Make RPC call with short timeout
    await expect(
      client.call('slow-method', {}, { timeout: 100 })
    ).rejects.toThrow('RPC call to slow-method timed out after 100ms')
  } finally {
    await client.close()
    await server.stop()
    await conn.close()
  }
})

test('RPC server can register and unregister methods', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  
  const server = new AMQPRpcServer(ch, 'test-rpc-queue-4')
  
  // Register a method
  server.register('test-method', () => 'success')
  expect(server.getMethods()).toContain('test-method')
  
  // Unregister the method
  server.unregister('test-method')
  expect(server.getMethods()).not.toContain('test-method')
  
  await conn.close()
})

test('RPC server prevents method registration after start', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  
  const server = new AMQPRpcServer(ch, 'test-rpc-queue-5')
  await server.start()
  
  try {
    expect(() => server.register('new-method', () => {})).toThrow('Cannot register methods after server has started')
  } finally {
    await server.stop()
    await conn.close()
  }
})

test('RPC supports async method handlers', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  
  // Set up RPC server with async handler
  const server = new AMQPRpcServer(ch, 'test-rpc-queue-6')
  server.register('async-add', async (params) => {
    await new Promise(resolve => setTimeout(resolve, 10)) // Small delay
    return params.a + params.b
  })
  await server.start()
  
  // Set up RPC client
  const client = new AMQPRpcClient(ch, 'test-rpc-queue-6')
  
  try {
    // Make RPC call
    const result = await client.call('async-add', { a: 10, b: 20 })
    expect(result).toBe(30)
  } finally {
    await client.close()
    await server.stop()
    await conn.close()
  }
})

test('RPC handles method handler errors', async () => {
  const amqp = getNewClient()
  const conn = await amqp.connect()
  const ch = await conn.channel()
  
  // Set up RPC server with error-throwing handler
  const server = new AMQPRpcServer(ch, 'test-rpc-queue-7')
  server.register('error-method', () => {
    throw new Error('Test error message')
  })
  await server.start()
  
  // Set up RPC client
  const client = new AMQPRpcClient(ch, 'test-rpc-queue-7')
  
  try {
    // Make RPC call that should fail
    await expect(client.call('error-method', {})).rejects.toThrow('Test error message')
  } finally {
    await client.close()
    await server.stop()
    await conn.close()
  }
})