# amqp-client.js

AMQP 0-9-1 client library for Node.js and browsers.

## Before committing

Run these checks and fix any issues:

```sh
npm run format:check   # prettier
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
```

To auto-fix formatting: `npm run format`

## Testing

```sh
npx vitest run test/<file>.ts   # run specific test file
npm run test:local              # run local tests with coverage
```

Full `npm test` (with coverage for all tests) may OOM — prefer targeted runs.

## Project structure

- `src/` — TypeScript source (ESM)
- `test/` — vitest tests
- `lib/` — build output (gitignored)
- `types/` — generated declarations (gitignored)

## Key conventions

- Prettier for formatting, eslint for linting
- `CodecMode` generic (`"plain" | "codec"`) threads through session/queue/exchange/rpc classes
- `AMQPMessage.body` starts as raw bytes, gets replaced by decoded value when codecs are configured
- `@internal` JSDoc + `stripInternal: true` hides internal API from declarations
