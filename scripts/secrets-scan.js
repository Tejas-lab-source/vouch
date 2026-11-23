// @ts-check
/**
 * Secrets scan (Phase 14). Looks for real credentials in every tracked file and, with
 * `--history`, in every commit of every branch. Exits 1 on any finding, printing only the file
 * (or commit), the line number and the rule — never the matched value.
 *
 * The rules are the well-known credential formats (cloud keys, provider tokens, private keys)
 * plus `.env` files committed by mistake. Test keys generated at runtime never match.
 *
 * Usage: node scripts/secrets-scan.js [--history]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {[string, RegExp][]} */
const RULES = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/],
  ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Resend API key', /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}\b/],
  ['Expo access token', /\bEXPO_ACCESS_TOKEN\s*=\s*[A-Za-z0-9_-]{20,}/],
  ['Sentry DSN with key', /https:\/\/[0-9a-f]{32}@[a-z0-9.-]+\.sentry\.io\//],
  [
    'Postgres URL with password',
    /postgres(?:ql)?:\/\/[^:\s/]+:(?!password|postgres|vouch|app|test|secret)[^@\s]{8,}@(?!localhost|127\.0\.0\.1|postgres|db)[a-z0-9.-]+\.[a-z]{2,}/,
  ],
  ['Turnstile secret', /\b0x4[A-Za-z0-9_-]{30,}\b/],
];

/** Paths that are never real secrets: generated or vendored. */
const SKIP = [/^pnpm-lock\.yaml$/, /(^|\/)node_modules\//, /\.(png|jpe?g|webp|ico|woff2?)$/];

/** An env file other than the committed examples. @param {string} path */
const isEnvFile = (path) => {
  const name = basename(path);
  return (name === '.env' || name.startsWith('.env.')) && !name.endsWith('.example');
};

/**
 * @param {string} label  file or commit
 * @param {string} text
 * @returns {string[]}
 */
export function scan(label, text) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const [rule, pattern] of RULES) {
      if (pattern.test(lines.at(i) ?? '')) findings.push(`${label}:${i + 1} ${rule}`);
    }
  }
  return findings;
}

const git = (/** @type {string[]} */ args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });

function main() {
  /** @type {string[]} */
  const findings = [];
  for (const file of git(['ls-files']).split('\n').filter(Boolean)) {
    if (SKIP.some((re) => re.test(file))) continue;
    if (isEnvFile(file)) findings.push(`${file} committed .env file`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths from git ls-files
    findings.push(...scan(file, readFileSync(file, 'utf8')));
  }

  if (process.argv.includes('--history')) {
    const commits = git(['rev-list', '--all']).split('\n').filter(Boolean);
    for (const commit of commits) {
      const patch = git(['show', '--no-color', '--format=', '--unified=0', commit]);
      const added = patch
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .join('\n');
      findings.push(...scan(`commit ${commit.slice(0, 10)}`, added));
      for (const file of git(['show', '--name-only', '--format=', commit]).split('\n')) {
        if (isEnvFile(file)) {
          findings.push(`commit ${commit.slice(0, 10)} added ${file}`);
        }
      }
    }
    process.stdout.write(`scanned ${commits.length} commits\n`);
  }

  if (findings.length > 0) {
    process.stderr.write(`secrets scan: ${findings.length} finding(s)\n`);
    for (const finding of findings) process.stderr.write(`  ${finding}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('secrets scan: no findings\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
