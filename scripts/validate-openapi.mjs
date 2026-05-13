import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';

const specPath = path.join(process.cwd(), 'docs', 'openapi.yaml');
const requiredPaths = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify',
  '/api/inbox/unified',
  '/api/messages/send-new',
  '/api/messages/thread',
  '/api/sync/messages',
  '/api/accounts/{id}/session',
  '/api/accounts/{id}/session/status',
  '/api/accounts/{id}/verify',
  '/api/health/startup-validation',
  '/api/health/summary',
  '/api/export/messages',
  '/api/stats/{accountId}/activity'
];

function fail(message) {
  console.error(`[openapi] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(specPath)) {
  fail(`Spec not found: ${specPath}`);
}

const raw = fs.readFileSync(specPath, 'utf8');
let doc;

try {
  doc = parse(raw);
} catch (error) {
  fail(`YAML parse failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (!doc || typeof doc !== 'object') {
  fail('Parsed spec is empty or invalid.');
}

if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.')) {
  fail('openapi version must be a 3.x string.');
}

if (!doc.info || typeof doc.info.title !== 'string' || typeof doc.info.version !== 'string') {
  fail('info.title and info.version are required.');
}

if (!doc.paths || typeof doc.paths !== 'object') {
  fail('paths section is required.');
}

for (const route of requiredPaths) {
  if (!doc.paths[route]) {
    fail(`Missing required path: ${route}`);
  }
}

const schemes = doc.components?.securitySchemes;
if (!schemes || typeof schemes !== 'object') {
  fail('components.securitySchemes is required.');
}

for (const schemeName of ['cookieAuth', 'apiKeyAuth', 'serviceToken']) {
  if (!schemes[schemeName]) {
    fail(`Missing required security scheme: ${schemeName}`);
  }
}

console.log(`[openapi] OK: ${specPath}`);
