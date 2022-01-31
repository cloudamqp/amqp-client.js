import typescript from '@rollup/plugin-typescript'

const options = {
  removeComments: true, // comments only required in declarations
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
  }
]
