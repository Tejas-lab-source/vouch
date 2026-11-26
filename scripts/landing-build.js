// @ts-check
/**
 * Builds the landing page for one environment (Phase 15; design update): fills in the deployed
 * URLs and the grievance address, refuses to leave a placeholder behind, and takes the brand
 * from @vouch/ui-tokens (colours, the wordmark) so it changes in one place. The fonts
 * (Poppins and Inter, WOFF2) and the illustrations are copied next to the page: no request
 * leaves the site.
 *
 *   SITE_URL=https://example.app WEB_URL=https://app.example.app \
 *   GRIEVANCE_EMAIL=grievance@example.app node scripts/landing-build.js
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssVariables, wordmark } from '../packages/ui-tokens/src/index.js';

/** The self-hosted font files the page uses (from @fontsource, via @vouch/ui-web). */
export const FONT_FILES = Object.freeze([
  'poppins/files/poppins-latin-600-normal.woff2',
  'poppins/files/poppins-latin-700-normal.woff2',
  'inter/files/inter-latin-400-normal.woff2',
  'inter/files/inter-latin-500-normal.woff2',
  'inter/files/inter-latin-600-normal.woff2',
]);

/** The illustrations (placeholders until the final art: replace the files, keep the names). */
export const ART_FILES = Object.freeze(['campus-placeholder.svg', 'pattern-placeholder.svg']);

/** `@font-face` rules for the copied files. */
function fontFaces() {
  return FONT_FILES.map((file) => {
    const name = file.slice(file.lastIndexOf('/') + 1);
    const [family, , weight] = name.split('-');
    const familyName = family === 'poppins' ? 'Poppins' : 'Inter';
    return `@font-face { font-family: '${familyName}'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url(/fonts/${name}) format('woff2'); }`;
  }).join('\n');
}

/** The wordmark as inline SVG (letters in the brand text colour, the heart in primary). */
function wordmarkSvg() {
  return [
    `<svg class="wordmark" viewBox="${wordmark.viewBox}" role="img" aria-label="Vouch">`,
    `<path class="wordmark__letters" d="${wordmark.letters}"/>`,
    `<path class="wordmark__heart" d="${wordmark.heart}"/>`,
    '</svg>',
  ].join('');
}

/**
 * @param {string} html
 * @param {Record<string, string | undefined>} values
 */
export function renderLanding(html, values) {
  const known = new Map(
    Object.entries({
      TOKENS_CSS: `${cssVariables()}\n${fontFaces()}`,
      WORDMARK: wordmarkSvg(),
      ...values,
    }),
  );
  const out = html.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name) => {
    const value = known.get(name);
    if (!value) throw new Error(`${name} is required`);
    return name.endsWith('_URL') ? new URL(value).origin : value;
  });
  return out;
}

/**
 * Writes `index.html`, the fonts and the art into `dist`.
 * @param {string} dist  An absolute folder.
 * @param {Record<string, string | undefined>} values
 */
export async function buildLanding(dist, values) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const require = createRequire(join(root, 'packages/ui-web/package.json'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- apps/landing, fixed
  const html = await readFile(join(root, 'apps/landing/index.html'), 'utf8');
  for (const folder of ['fonts', 'art']) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the build folder given
    await mkdir(join(dist, folder), { recursive: true });
  }
  for (const file of FONT_FILES) {
    const from = join(
      dirname(require.resolve(`@fontsource/${file.split('/')[0]}/package.json`)),
      file.slice(file.indexOf('/') + 1),
    );
    await copyFile(from, join(dist, 'fonts', file.slice(file.lastIndexOf('/') + 1)));
  }
  for (const file of ART_FILES) {
    await copyFile(join(root, 'packages/ui-web/assets', file), join(dist, 'art', file));
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the build folder given
  await writeFile(join(dist, 'index.html'), renderLanding(html, values));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = fileURLToPath(new URL('../apps/landing/dist/', import.meta.url));
  await buildLanding(dist, {
    SITE_URL: process.env.SITE_URL,
    WEB_URL: process.env.WEB_URL,
    GRIEVANCE_EMAIL: process.env.GRIEVANCE_EMAIL,
  });
  process.stdout.write('wrote apps/landing/dist/index.html, fonts/ and art/\n');
}
