// @ts-check
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { normaliseEmail } from '../src/modules/identity/domain/email.js';
import { INVITE_ONLY_FLAG } from '../src/modules/identity/domain/invite.js';
import { systemClock as clock } from '../src/platform/clock.js';
import { createIdGenerator } from '../src/platform/ids.js';

/**
 * Adds a launch college (Phase 15): its campus cluster (created on first use, by name), the
 * college with its student email domains, and optionally puts it behind invite-only sign-up
 * (the `beta.invite_only` flag's campus rule). Run in the Render shell, or locally against
 * staging:
 *
 *   node scripts/college-add.js --name "JIIT Noida" --city Noida --cluster "Noida" \
 *     --domains mail.jiit.ac.in --invite-only
 *
 * Refuses a domain that already belongs to an active college. Runs as the database login
 * (the migration owner), in one transaction. Flags are cached for up to 30 s.
 * @param {{
 *   sql: import('postgres').Sql,
 *   newId: () => string,
 *   name: string,
 *   city: string,
 *   cluster: string,
 *   domains: string[],
 *   inviteOnly: boolean,
 * }} input
 * @returns {Promise<{ collegeId: string, clusterId: string, inviteOnly: boolean }>}
 */
export async function addCollege({ sql, newId, name, city, cluster, domains, inviteOnly }) {
  const cleaned = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length === 0) throw new Error('give at least one email domain');
  for (const domain of cleaned) {
    if (normaliseEmail(`student@${domain}`)?.domain !== domain) {
      throw new Error(`not an email domain: ${domain}`);
    }
  }
  return sql.begin(async (tx) => {
    const taken = await tx`SELECT name, email_domains FROM platform.colleges
      WHERE active AND email_domains && ${cleaned}::text[]`;
    if (taken.length > 0) {
      throw new Error(`a domain already belongs to an active college: ${taken[0]?.name}`);
    }
    const [existingCluster] = await tx`SELECT id FROM platform.campus_clusters
      WHERE name = ${cluster}`;
    const clusterId = existingCluster?.id ?? newId();
    if (!existingCluster) {
      await tx`INSERT INTO platform.campus_clusters (id, name, city)
        VALUES (${clusterId}, ${cluster}, ${city})`;
    }
    const collegeId = newId();
    await tx`INSERT INTO platform.colleges (id, name, email_domains, cluster_id, city)
      VALUES (${collegeId}, ${name}, ${cleaned}::text[], ${clusterId}, ${city})`;

    if (inviteOnly) {
      const [flag] = await tx`SELECT rules FROM platform.feature_flags
        WHERE key = ${INVITE_ONLY_FLAG} FOR UPDATE`;
      /** @type {any[]} */
      const rules = flag?.rules ?? [];
      const campus = rules.find((rule) => rule.type === 'campus');
      if (rules.length > (campus ? 1 : 0)) {
        throw new Error(
          `${INVITE_ONLY_FLAG} has rules other than one campus rule; edit it by hand`,
        );
      }
      const collegeIds = [...(campus?.collegeIds ?? []), collegeId];
      const next = [{ type: 'campus', collegeIds }];
      await tx`INSERT INTO platform.feature_flags (key, enabled, rules)
        VALUES (${INVITE_ONLY_FLAG}, true, ${tx.json(next)})
        ON CONFLICT (key) DO UPDATE SET enabled = true, rules = EXCLUDED.rules`;
    }
    return { collegeId, clusterId, inviteOnly };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      city: { type: 'string' },
      cluster: { type: 'string' },
      domains: { type: 'string' },
      'invite-only': { type: 'boolean', default: false },
    },
  });
  if (!values.name || !values.city || !values.domains) {
    throw new Error(
      'usage: node scripts/college-add.js --name <college> --city <city> ' +
        '[--cluster <campus cluster, default: the city>] --domains <a.edu,b.edu> [--invite-only]',
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const result = await addCollege({
      sql,
      newId: createIdGenerator({ clock }),
      name: values.name,
      city: values.city,
      cluster: values.cluster ?? values.city,
      domains: values.domains.split(','),
      inviteOnly: values['invite-only'] === true,
    });
    process.stdout.write(
      `college ${result.collegeId} added (cluster ${result.clusterId})` +
        `${result.inviteOnly ? ', invite-only (live within 30 s)' : ''}\n` +
        `next: node scripts/invite-create.js --college ${result.collegeId} --count 50\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`college-add failed: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
