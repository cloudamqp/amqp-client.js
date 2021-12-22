import typescript from '@rollup/plugin-typescript'

export default [
  {
    input: 'src/amqp-websocket-client.ts',
    plugins: [typescript({
      target: "es6",
      module: "es2020",
      lib: ["es6", "dom"],
      outDir: "dist",
      declarationDir: "dist",
      removeComments: true,
      exclude: ["src/amqp-client.ts"]
    })],
    output: {
      file: 'dist/amqp-websocket-client.mjs',
      sourcemap: 'dist/amqp-websocket-client.mjs.map'
    }
  }
]
