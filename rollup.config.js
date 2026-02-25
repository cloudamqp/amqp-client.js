import sourcemaps from "rollup-plugin-sourcemaps"

export default [
  {
    input: "lib/mjs/amqp-websocket-client.js",
    plugins: [sourcemaps()],
    // amqp-socket-client uses Node.js built-ins (net, tls, Buffer) and must
    // never be bundled into the browser build. It stays as an external dynamic
    // import that only fires for amqp:// URLs — an invalid scheme in browsers.
    external: (id) => id.includes("amqp-socket-client"),
    output: {
      file: "dist/amqp-websocket-client.mjs",
      sourcemap: "dist/amqp-websocket-client.mjs.map",
      sourcemapExcludeSources: true,
      // Dynamic imports (amqp-session re-exports) must be inlined so the
      // output remains a single file compatible with output.file.
      inlineDynamicImports: true,
    },
  },
]
