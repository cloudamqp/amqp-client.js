# AMQP Client.js Development Instructions

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Project Overview
AMQP client.js is a TypeScript library providing AMQP 0-9-1 client functionality for both Node.js (TCP Socket) and browsers (WebSocket). The library has zero runtime dependencies and is designed for high performance messaging.

## Working Effectively

### Prerequisites and Setup
- Requires Node.js >= 16.0.0 (verified working with Node.js 20.x)
- Docker and Docker Compose for RabbitMQ testing server
- For browser testing: Playwright (optional, may not work in all environments)

### Bootstrap and Build Process
Run these commands in sequence:

1. **Install dependencies**:
   ```bash
   npm install
   ```
   - Takes ~16 seconds
   - Automatically runs the build process via `prepare` script
   - NEVER CANCEL: Set timeout to 30+ minutes for initial install

2. **Manual build** (if needed):
   ```bash
   npm run build
   ```
   - Takes ~5.4 seconds 
   - NEVER CANCEL: Set timeout to 10+ minutes
   - Creates three output formats:
     - ES modules in `lib/mjs/`
     - CommonJS modules in `lib/cjs/`
     - TypeScript declarations in `types/`
     - Browser bundle in `dist/`

3. **Start RabbitMQ services**:
   ```bash
   docker compose up -d
   ```
   - Takes ~11 seconds for first startup
   - NEVER CANCEL: Set timeout to 15+ minutes for Docker image pulls
   - Starts RabbitMQ server on ports 5671 (TLS) and 5672 (plain)
   - Starts WebSocket TCP relay on port 15670

### Testing

#### Node.js Tests
```bash
npm test
```
- Takes ~15 seconds
- NEVER CANCEL: Set timeout to 30+ minutes
- Runs Node.js tests with coverage using Vitest
- **EXPECTED**: 2 TLS-related tests may fail if certificates are not set up (normal in development)
- All other tests should pass when RabbitMQ is running

#### Browser Tests  
```bash
npx playwright install --with-deps chromium
npm run test-browser
```
- **WARNING**: Playwright installation often fails in CI environments
- Browser tests require WebSocket functionality
- NEVER CANCEL: Playwright install can take 30+ minutes
- Only attempt browser tests if Playwright installs successfully

#### Linting
```bash
npm run lint
```
- Takes ~1.8 seconds
- Uses ESLint with TypeScript support
- Must pass before committing (CI requirement)

#### Documentation Generation
```bash
npm run docs  
```
- Takes ~3.4 seconds
- Generates API documentation in `docs/` directory
- Uses TypeDoc

### Validation Scenarios
After making changes, always run this validation sequence:

1. **Build validation**: `npm run build` - ensure TypeScript compilation succeeds
2. **Test validation**: `npm test` - run Node.js tests (RabbitMQ must be running)
3. **Lint validation**: `npm run lint` - ensure code style compliance
4. **Functionality validation**: Test actual AMQP operations (see examples below)

### Manual Functional Testing
Always test functionality manually when making changes to core AMQP logic:

```javascript
import { AMQPClient } from './lib/mjs/index.js';

// Basic publish/consume test
const amqp = new AMQPClient("amqp://localhost");
const conn = await amqp.connect();
const ch = await conn.channel();
const q = await ch.queue("test-queue");
await q.publish("test message");
const consumer = await q.subscribe({noAck: true}, (msg) => {
  console.log("Received:", msg.bodyString());
});
// Clean up: consumer.cancel(), q.delete(), conn.close()
```

## Important Files and Structure

### Source Code (`src/`)
- `amqp-socket-client.ts` - Node.js TCP client implementation
- `amqp-websocket-client.ts` - Browser WebSocket client implementation  
- `amqp-channel.ts` - AMQP channel implementation
- `amqp-queue.ts` - Queue operations
- `amqp-message.ts` - Message handling
- `index.ts` - Main exports

### Tests (`test/`)
- `test.ts` - Main Node.js test suite
- `tls.ts` - TLS connection tests (may fail without certificates)

### Browser Tests (`test-browser/`)
- `websocket.ts` - WebSocket client tests

### Configuration Files
- `package.json` - Build scripts and dependencies
- `tsconfig.json` - TypeScript configuration
- `vitest.config.ts` - Node.js test configuration
- `vitest.config.browser.ts` - Browser test configuration
- `docker-compose.yml` - RabbitMQ test environment

### Build Output
- `lib/mjs/` - ES module builds
- `lib/cjs/` - CommonJS builds  
- `types/` - TypeScript declarations
- `dist/` - Browser-ready bundles

## Common Issues and Solutions

### RabbitMQ Connection Issues
- Ensure `docker compose up -d` has been run
- Check containers are healthy: `docker compose ps`
- RabbitMQ takes ~20 seconds to fully start

### Build Failures
- Run `npm run prebuild` to clean build directories
- Ensure TypeScript has no compilation errors
- Check Node.js version is >= 16.0.0

### Test Failures
- TLS tests failing: Expected if mkcert certificates not installed
- Connection errors: Ensure RabbitMQ is running via Docker
- WebSocket tests failing: Expected if Playwright not installed

### Browser Testing Limitations
- WebSocket client requires browser environment or WebSocket polyfill
- Playwright installation may fail in some CI environments
- Browser bundle available in `dist/amqp-websocket-client.mjs`

## Performance Notes
- Library has zero runtime dependencies
- Supports high-throughput messaging (300k+ msgs/sec publish, 512k+ msgs/sec consume)
- Uses DataView for binary protocol parsing (browser compatibility)
- Optimized frame buffering for WebSocket connections

## Development Workflow
1. Start RabbitMQ: `docker compose up -d`
2. Install dependencies: `npm install` 
3. Make changes to `src/` files
4. Build: `npm run build`
5. Test: `npm test`
6. Lint: `npm run lint`
7. Manual validation with real AMQP operations
8. Clean up: `docker compose down`

Always run the full validation sequence before committing changes. The CI pipeline (.github/workflows/ci.yml) will run all these steps and must pass for merge approval.