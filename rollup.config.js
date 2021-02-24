import json from '@rollup/plugin-json'

export default {
  input: 'src/amqp-websocket-client.mjs',
  output: {
    file: 'dist/amqp-websocket-client.mjs'
  },
  plugins: [ json() ]
};
