import typescript from '@rollup/plugin-typescript'

const options = {
  exclude: ["src/amqp-client.ts"], // includes a ts hack for default export in commonjs module
  removeComments: true, // comments only required in declrations
  declaration: false, // let tsc generate declarations
  declarationMap: false,
  declarationDir: null
}
export default [
  {
    input: 'src/amqp-websocket-client.ts',
    plugins: [typescript({target: "es6", lib: ["es6", "dom"], ...options})],
    output: {
      file: 'dist/amqp-websocket-client.mjs',
      sourcemap: 'dist/amqp-websocket-client.mjs.map'
    }
  }, {
    input: 'src/amqp-socket-client.ts',
    external: ['buffer', 'net', 'tls'],
    plugins: [typescript(options)],
    output: {
      file: 'dist/amqp-client.cjs',
      format: 'cjs',
      exports: 'default',
      sourcemap: 'dist/amqp-client.cjs.map'
    }
  }, {
    input: 'src/amqp-socket-client.ts',
    external: ['buffer', 'net', 'tls'],
    plugins: [typescript(options)],
    output: {
      file: 'dist/amqp-client.mjs',
      exports: 'default',
      sourcemap: 'dist/amqp-client.mjs.map'
    }
  }
]
