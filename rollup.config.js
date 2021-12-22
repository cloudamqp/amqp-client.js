import typescript from '@rollup/plugin-typescript'

export default [
  {
    input: 'src/amqp-websocket-client.ts',
    plugins: [typescript({target: "es6", lib: ["es6", "dom"], removeComments: true})],
    output: {
      file: 'dist/amqp-websocket-client.mjs',
      sourcemap: 'dist/amqp-websocket-client.mjs.map'
    }
  }
]
