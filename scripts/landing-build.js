// @ts-check
/**
 * Builds the landing page for one environment (Phase 15): fills in the deployed URLs and the
 * grievance address, and refuses to leave a placeholder behind.
 *
 *   SITE_URL=https://example.app WEB_URL=https://app.example.app \
 *   GRIEVANCE_EMAIL=grievance@example.app node scripts/landing-build.js
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} html
 * @param {Record<string, string | undefined>} values
 */
export function renderLanding(html, values) {
  const known = new Map(Object.entries(values));
  const out = html.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name) => {
    const value = known.get(name);
    if (!value) throw new Error(`${name} is required`);
    return name.endsWith('_URL') ? new URL(value).origin : value;
  });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = new URL('../apps/landing/', import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- apps/landing, fixed
  const html = await readFile(new URL('index.html', here), 'utf8');
  const dist = new URL('dist/', here);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- apps/landing/dist
  await mkdir(dist, { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- apps/landing/dist
  await writeFile(
    new URL('index.html', dist),
    renderLanding(html, {
      SITE_URL: process.env.SITE_URL,
      WEB_URL: process.env.WEB_URL,
      GRIEVANCE_EMAIL: process.env.GRIEVANCE_EMAIL,
    }),
  );
  process.stdout.write('wrote apps/landing/dist/index.html\n');
}
