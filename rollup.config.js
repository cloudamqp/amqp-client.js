import cleanup from 'rollup-plugin-cleanup';

export default {
  input: 'src/amqp-websocket-client.mjs',
  plugins: [cleanup()],
  output: {
    file: 'dist/amqp-websocket-client.mjs'
  }
};
