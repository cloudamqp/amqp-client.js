import cleanup from 'rollup-plugin-cleanup'
import rollupTypescript from '@rollup/plugin-typescript'

export default {
  input: 'src/amqp-websocket-client.ts',
  plugins: [cleanup({extensions: ['ts', 'json']}), rollupTypescript()],
  output: {
    file: 'dist/amqp-websocket-client.mjs'
  }
}
