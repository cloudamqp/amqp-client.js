import sourcemaps from 'rollup-plugin-sourcemaps'

export default [
  {
    input: 'lib/mjs/amqp-websocket-client.js',
    plugins: [sourcemaps()],
    output: {
      file: 'dist/amqp-websocket-client.mjs',
      sourcemap: 'dist/amqp-websocket-client.mjs.map',
      sourcemapExcludeSources: true
    }
  }
]
