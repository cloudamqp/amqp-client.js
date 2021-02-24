import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';

export default [
  {
    input: 'src/amqp-websocket-client.mjs',
    output: [{
      file: 'dist/amqp-websocket-client.mjs',
    }],
    plugins: [json()]
  }, {
    input: 'src/amqp-websocket-client.mjs',
    output: {
      file: 'dist/amqp-websocket-client.js',
      exports: 'default',
      format: 'iife',
      name: 'AMQPWebsocketClient',
    },
    plugins: [
      json(),
      resolve({ browser: true }),
      babel({ babelHelpers: 'bundled' }),
      commonjs(),
    ]
  }
];
