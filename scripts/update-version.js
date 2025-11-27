import { readFileSync, writeFileSync } from 'fs';

const version = process.env.npm_package_version;
if (!version) {
  console.error('Error: npm_package_version not found');
  process.exit(1);
}

const file = 'src/amqp-base-client.ts';
const content = readFileSync(file, 'utf8');
const updated = content.replace(/VERSION = ".*"/, `VERSION = "${version}"`);
writeFileSync(file, updated);
