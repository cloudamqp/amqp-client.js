import cleanup from 'rollup-plugin-cleanup'
import typescript from '@rollup/plugin-typescript'

export default [
  {
    input: 'src/amqp-websocket-client.ts',
    plugins: [typescript({target: "es6"}), cleanup()],
    output: {
      sourcemap: 'dist/amqp-websocket-client.mjs.map',
      file: 'dist/amqp-websocket-client.mjs'
    }
  }
]
