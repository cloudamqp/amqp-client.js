import cleanup from 'rollup-plugin-cleanup';

export default [
  {
    input: 'src/amqp-websocket-client.mjs',
    plugins: [cleanup()],
    output: {
      file: 'dist/amqp-websocket-client.mjs'
    }
  },
  {
    input: 'src/amqp-socket-client.mjs',
    external: ['buffer', 'net', 'tls', 'process'],
    plugins: [cleanup()],
    output: {
      file: 'dist/amqp-socket-client.cjs',
      format: 'cjs',
      exports: 'default',
    }
  },
  {
    input: 'src/amqp-websocket-client.mjs',
    plugins: [cleanup()],
    output: {
      file: 'dist/amqp-websocket-client.cjs',
      format: 'cjs',
      exports: 'default',
    }
  },
];
