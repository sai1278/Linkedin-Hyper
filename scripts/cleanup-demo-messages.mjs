import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pkgPg from 'pg';
import Redis from 'ioredis';

const { Pool } = pkgPg;

const TARGET_TEXTS = [
  'EYYYY',
  'HEYYY',
  'how are you',
  'kk!',
  'okay',
  'OKAYYY',
  'text me',
];

function parseArgs(argv) {
  const options = {
    accountId: '',
    conversationId: '',
    participantName: '',
    profileUrl: '',
    confirm: false,
    dryRun: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--confirm') {
      options.confirm = true;
      options.dryRun = false;
      continue;
    }
    if (token === '--dry-run') {
      options.dryRun = true;
      options.confirm = false;
      continue;
    }
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (typeof next === 'undefined' || next.startsWith('--')) {
      continue;
    }

    if (key in options) {
      options[key] = next.trim();
      index += 1;
    }
  }

  return options;
}

function loadEnvFiles() {
  const envMap = {};
  for (const relativePath of ['.env.local', '.env', 'worker/.env']) {
    const absolutePath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(absolutePath)) continue;

    const text = fs.readFileSync(absolutePath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) continue;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!envMap[key] && value) {
        envMap[key] = value;
      }
    }
  }

  return envMap;
}

function getEnvValue(envMap, key) {
  return process.env[key] || envMap[key] || '';
}

function printUsage() {
  console.log(`
Usage:
  npm run cleanup:demo-messages -- --accountId saikanchi130 --dry-run
  npm run cleanup:demo-messages -- --accountId saikanchi130 --participantName "Kanchi Dhyana Sai" --confirm

Optional filters:
  --conversationId <id>
  --participantName <name>
  --profileUrl <url>

Notes:
  - dry-run is the default
  - only the exact demo texts are targeted
  - confirm mode refuses broad deletes unless the matches resolve to one conversation/participant scope
`.trim());
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  return normalizeText(value).replace(/\/+$/, '').toLowerCase();
}

function normalizeName(value) {
  return normalizeText(value).replace(/\s+/g, ' ').toLowerCase();
}

function matchesOptionalScope(match, options) {
  if (options.conversationId && normalizeText(match.conversationId) !== normalizeText(options.conversationId)) {
    return false;
  }
  if (options.participantName && normalizeName(match.participantName) !== normalizeName(options.participantName)) {
    return false;
  }
  if (options.profileUrl && normalizeUrl(match.profileUrl) !== normalizeUrl(options.profileUrl)) {
    return false;
  }
  return true;
}

function collectSafetyScopes(dbMatches, redisMatches) {
  const scopes = new Set();
  dbMatches.forEach((match) => {
    scopes.add(`db:${match.conversationId || ''}:${normalizeUrl(match.profileUrl) || normalizeName(match.participantName)}`);
  });
  redisMatches.forEach((match) => {
    scopes.add(`redis:${normalizeUrl(match.profileUrl) || normalizeName(match.participantName)}`);
  });
  return scopes;
}

async function inspectDatabase(options, envMap) {
  const connectionString = getEnvValue(envMap, 'POSTGRES_URL') || getEnvValue(envMap, 'DATABASE_URL');
  if (!connectionString) {
    return { skipped: true, reason: 'POSTGRES_URL / DATABASE_URL not configured', matches: [] };
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 2000,
  });

  try {
    const params = [options.accountId, TARGET_TEXTS];
    const filters = [
      'm."accountId" = $1',
      'm."text" = ANY($2)',
    ];

    if (options.conversationId) {
      params.push(options.conversationId);
      filters.push(`m."conversationId" = $${params.length}`);
    }

    if (options.participantName) {
      params.push(options.participantName);
      filters.push(`LOWER(TRIM(c."participantName")) = LOWER(TRIM($${params.length}))`);
    }

    if (options.profileUrl) {
      params.push(options.profileUrl);
      filters.push(`LOWER(REGEXP_REPLACE(COALESCE(c."participantProfileUrl", ''), '/+$', '')) = LOWER(REGEXP_REPLACE($${params.length}, '/+$', ''))`);
    }

    const query = `
      SELECT
        m."id",
        m."accountId" AS "accountId",
        m."conversationId" AS "conversationId",
        c."participantName" AS "participantName",
        COALESCE(c."participantProfileUrl", '') AS "profileUrl",
        m."text",
        m."isSentByMe" AS "isSentByMe",
        m."senderName" AS "senderName",
        m."senderId" AS "senderId",
        m."sentAt" AS "sentAt",
        COALESCE(m."linkedinMessageId", '') AS "linkedinMessageId"
      FROM messages m
      JOIN conversations c
        ON c."id" = m."conversationId"
      WHERE ${filters.join(' AND ')}
      ORDER BY m."sentAt" ASC
    `;

    const result = await pool.query(query, params);
    return { skipped: false, matches: result.rows };
  } finally {
    await pool.end();
  }
}

async function deleteDatabaseMatches(envMap, matchIds) {
  const connectionString = getEnvValue(envMap, 'POSTGRES_URL') || getEnvValue(envMap, 'DATABASE_URL');
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 2000,
  });

  try {
    const result = await pool.query(
      'DELETE FROM messages WHERE "id" = ANY($1)',
      [matchIds]
    );
    return result.rowCount || 0;
  } finally {
    await pool.end();
  }
}

function buildRedisClient(envMap) {
  const redisUrl = getEnvValue(envMap, 'REDIS_URL');
  if (redisUrl) {
    const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    client.on('error', () => {});
    return client;
  }

  const host = getEnvValue(envMap, 'REDIS_HOST');
  const port = Number.parseInt(getEnvValue(envMap, 'REDIS_PORT') || '6379', 10);
  if (!host) {
    return null;
  }

  const client = new Redis({
    host,
    port,
    password: getEnvValue(envMap, 'REDIS_PASSWORD') || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  client.on('error', () => {});
  return client;
}

async function inspectRedisActivity(options, envMap) {
  const client = buildRedisClient(envMap);
  if (!client) {
    return { skipped: true, reason: 'REDIS_URL / REDIS_HOST not configured', matches: [], key: `activity:log:${options.accountId}` };
  }

  const key = `activity:log:${options.accountId}`;
  try {
    try {
      await client.connect();
    } catch (error) {
      return {
        skipped: true,
        reason: `redis unavailable: ${error.message}`,
        matches: [],
        key,
        rawEntries: [],
      };
    }
    const rawEntries = await client.lrange(key, 0, 999);
    const matches = [];

    rawEntries.forEach((rawEntry, index) => {
      try {
        const entry = JSON.parse(rawEntry);
        if (entry?.type !== 'messageSent') return;
        if (!TARGET_TEXTS.includes(normalizeText(entry.textPreview))) return;

        const match = {
          index,
          rawEntry,
          text: normalizeText(entry.textPreview),
          participantName: normalizeText(entry.targetName),
          profileUrl: normalizeText(entry.targetProfileUrl),
          timestamp: Number(entry.timestamp) || 0,
          conversationId: '',
        };

        if (!matchesOptionalScope(match, options)) {
          return;
        }

        matches.push(match);
      } catch {
        // Ignore malformed activity rows.
      }
    });

    return { skipped: false, key, matches, rawEntries };
  } finally {
    client.disconnect();
  }
}

async function rewriteRedisActivityLog(envMap, key, remainingEntries) {
  const client = buildRedisClient(envMap);
  if (!client) {
    throw new Error('Redis is not configured');
  }

  try {
    await client.connect();
    const multi = client.multi();
    multi.del(key);
    if (remainingEntries.length > 0) {
      multi.rpush(key, ...remainingEntries);
    }
    await multi.exec();
  } finally {
    client.disconnect();
  }
}

function printMatchSection(title, matches, formatter) {
  console.log(`\n${title}: ${matches.length}`);
  matches.forEach((match) => {
    console.log(`- ${formatter(match)}`);
  });
}

function formatTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.accountId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const envMap = loadEnvFiles();
  const dbResult = await inspectDatabase(options, envMap).catch((error) => ({
    skipped: true,
    reason: `database inspection failed: ${error.message}`,
    matches: [],
  }));
  const redisResult = await inspectRedisActivity(options, envMap).catch((error) => ({
    skipped: true,
    reason: `redis inspection failed: ${error.message}`,
    matches: [],
    key: `activity:log:${options.accountId}`,
    rawEntries: [],
  }));

  console.log(`Account: ${options.accountId}`);
  console.log(`Mode: ${options.confirm ? 'confirm' : 'dry-run'}`);
  console.log(`Texts: ${TARGET_TEXTS.join(', ')}`);

  if (dbResult.skipped) {
    console.log(`DB inspection: skipped (${dbResult.reason})`);
  } else {
    printMatchSection('DB matches', dbResult.matches, (match) => (
      `${formatTimestamp(match.sentAt)} | ${match.participantName || 'Unknown'} | ${match.conversationId} | ${match.text} | sentByMe=${match.isSentByMe}`
    ));
  }

  if (redisResult.skipped) {
    console.log(`Redis activity inspection: skipped (${redisResult.reason})`);
  } else {
    printMatchSection('Redis activity matches', redisResult.matches, (match) => (
      `${new Date(match.timestamp).toISOString()} | ${match.participantName || 'Unknown'} | ${match.text} | key=${redisResult.key} | index=${match.index}`
    ));
  }

  if (!options.confirm) {
    console.log('\nDry-run complete. Re-run with --confirm after reviewing the matches.');
    return;
  }

  const safetyScopes = collectSafetyScopes(dbResult.matches, redisResult.matches);
  const hasExplicitScope = Boolean(options.conversationId || options.participantName || options.profileUrl);
  if (!hasExplicitScope && safetyScopes.size > 1) {
    console.log('\nConfirm aborted: matches span multiple conversations/participants. Add --conversationId, --participantName, or --profileUrl to narrow the delete scope.');
    process.exitCode = 1;
    return;
  }

  let deletedDbCount = 0;
  let deletedRedisCount = 0;

  if (!dbResult.skipped && dbResult.matches.length > 0) {
    deletedDbCount = await deleteDatabaseMatches(envMap, dbResult.matches.map((match) => match.id));
  }

  if (!redisResult.skipped && redisResult.matches.length > 0) {
    const matchedRawEntries = new Set(redisResult.matches.map((match) => match.rawEntry));
    const remainingEntries = (redisResult.rawEntries || []).filter((rawEntry) => !matchedRawEntries.has(rawEntry));
    await rewriteRedisActivityLog(envMap, redisResult.key, remainingEntries);
    deletedRedisCount = redisResult.matches.length;
  }

  console.log(`\nDeleted DB rows: ${deletedDbCount}`);
  console.log(`Deleted Redis activity rows: ${deletedRedisCount}`);
}

await main();
