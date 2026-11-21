// @ts-check
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { z } from 'zod';
import { createPrng } from './lib/prng.js';
import { uuidv7From } from '../src/platform/ids.js';

/** Fixed inputs: the same seed always produces byte-identical rows. */
const SEED = 20261121;
const USER_COUNT = 2000;
const BATCH_SIZE = 500;
const BASE_TIME_MS = Date.UTC(2026, 8, 1); // 2026-09-01, synthetic sign-up start
const SIGNUP_SPACING_MS = 60_000;
const DAY_MS = 86_400_000;

/** Not a secret: synthetic users need a stable HMAC key so their email_hmac is repeatable. */
const SEED_HMAC_KEY = 'vouch-synthetic-seed-key';

const CLUSTER = { name: 'Demo Cluster', city: 'Pune' };
const COLLEGES = [
  { name: 'Northfield Institute of Technology', domain: 'northfield.example.edu' },
  { name: 'Riverside College of Arts and Science', domain: 'riverside.example.edu' },
];
const FIRST_NAMES = [
  'Aarav',
  'Aditi',
  'Arjun',
  'Diya',
  'Ishaan',
  'Kavya',
  'Meera',
  'Neel',
  'Priya',
  'Rohan',
  'Saanvi',
  'Tara',
  'Vihaan',
  'Zara',
  'Kabir',
  'Anaya',
  'Dev',
  'Isha',
  'Reyansh',
  'Myra',
];
/** Gender codes are placeholders until packages/contracts defines them (Phase 3). */
const GENDERS = [0, 1, 2];

/**
 * @typedef {object} SeedCounts
 * @property {number} clusters
 * @property {number} colleges
 * @property {number} users
 * @property {number} profiles
 * @property {number} photos
 */

/**
 * Returns a deterministic id for the n-th entity of a kind.
 * @param {import('./lib/prng.js').Prng} prng
 * @param {number} timestampMs
 */
function nextId(prng, timestampMs) {
  return uuidv7From(timestampMs, prng.bytes(10));
}

/**
 * Builds every row in memory from the fixed seed.
 * @returns {{ cluster: object, colleges: object[], users: object[], profiles: object[], photos: object[] }}
 */
export function buildSeedData() {
  const prng = createPrng(SEED);
  const cluster = { id: nextId(prng, BASE_TIME_MS), ...CLUSTER };
  const colleges = COLLEGES.map((college) => ({
    id: nextId(prng, BASE_TIME_MS),
    name: college.name,
    email_domains: [college.domain],
    cluster_id: cluster.id,
    city: CLUSTER.city,
  }));

  /** @type {object[]} */
  const users = [];
  /** @type {object[]} */
  const profiles = [];
  /** @type {object[]} */
  const photos = [];

  for (let i = 0; i < USER_COUNT; i += 1) {
    const createdMs = BASE_TIME_MS + i * SIGNUP_SPACING_MS;
    const college = prng.pick(colleges);
    const domain = college.email_domains[0];
    const id = nextId(prng, createdMs);
    const ageDays = prng.int(18 * 366, 25 * 365);
    const birthDate = new Date(createdMs - ageDays * DAY_MS).toISOString().slice(0, 10);
    const gender = prng.pick(GENDERS);

    users.push({
      id,
      public_id: Buffer.from(prng.bytes(16)).toString('base64url'),
      college_id: college.id,
      email_hmac: createHmac('sha256', SEED_HMAC_KEY).update(`user${i}@${domain}`).digest(),
      status: 'active',
      birth_date: birthDate,
      grad_year: prng.int(2027, 2030),
      created_at: new Date(createdMs),
      updated_at: new Date(createdMs),
    });

    profiles.push({
      user_id: id,
      college_id: college.id,
      cluster_id: cluster.id,
      name: prng.pick(FIRST_NAMES),
      gender,
      interested_in: gender === 2 ? [0, 1, 2] : [prng.pick([0, 1])],
      birth_date: birthDate,
      min_age: 18,
      max_age: prng.int(24, 30),
      status: 'active',
      last_active_at: new Date(createdMs + prng.int(0, 30) * DAY_MS),
      created_at: new Date(createdMs),
      updated_at: new Date(createdMs),
    });

    const photoCount = prng.int(2, 4);
    for (let position = 0; position < photoCount; position += 1) {
      const photoId = nextId(prng, createdMs);
      photos.push({
        id: photoId,
        user_id: id,
        status: 'approved',
        position,
        key_1080: `photos/${id}/${photoId}_1080.webp`,
        key_400: `photos/${id}/${photoId}_400.webp`,
        created_at: new Date(createdMs),
        updated_at: new Date(createdMs),
      });
    }
  }

  return { cluster, colleges, users, profiles, photos };
}

/**
 * Inserts rows in batches, skipping rows that already exist.
 * @param {import('postgres').Sql | import('postgres').TransactionSql} tx
 * @param {string} table  Fully qualified, from the fixed list in `seed` only.
 * @param {object[]} rows
 * @param {string} conflictTarget
 */
async function insertAll(tx, table, rows, conflictTarget) {
  const [schema, name] = table.split('.');
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    await tx`INSERT INTO ${tx(schema)}.${tx(name)} ${tx(batch)} ON CONFLICT (${tx(conflictTarget)}) DO NOTHING`;
  }
}

/**
 * Seeds synthetic data idempotently in one transaction. Safe to run repeatedly.
 * @param {import('postgres').Sql} sql  Connection with write access to the seeded schemas.
 * @returns {Promise<SeedCounts>} Row counts after seeding.
 */
export async function seed(sql) {
  const data = buildSeedData();
  await sql.begin(async (tx) => {
    await insertAll(tx, 'platform.campus_clusters', [data.cluster], 'id');
    await insertAll(tx, 'platform.colleges', data.colleges, 'id');
    await insertAll(tx, 'identity.users', data.users, 'id');
    await insertAll(tx, 'profiles.profiles', data.profiles, 'user_id');
    await insertAll(tx, 'profiles.photos', data.photos, 'id');
  });

  const [counts] = await sql`
    SELECT
      (SELECT count(*)::int FROM platform.campus_clusters) AS clusters,
      (SELECT count(*)::int FROM platform.colleges) AS colleges,
      (SELECT count(*)::int FROM identity.users) AS users,
      (SELECT count(*)::int FROM profiles.profiles) AS profiles,
      (SELECT count(*)::int FROM profiles.photos) AS photos`;
  return /** @type {SeedCounts} */ (/** @type {unknown} */ (counts));
}

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  NODE_ENV: z.string().optional(),
});

/**
 * CLI: `node scripts/seed.js`, reading DATABASE_URL. Refuses to run in production.
 * @returns {Promise<void>}
 */
async function main() {
  const env = envSchema.parse(process.env);
  if (env.NODE_ENV === 'production') throw new Error('refusing to seed with NODE_ENV=production');
  const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    const started = performance.now();
    const counts = await seed(sql);
    const ms = Math.round(performance.now() - started);
    process.stdout.write(`seeded in ${ms} ms: ${JSON.stringify(counts)}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
