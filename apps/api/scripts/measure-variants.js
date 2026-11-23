// @ts-check
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSharpProcessor } from '../src/modules/media/adapters/image/sharp.js';

/**
 * `node scripts/measure-variants.js photo.jpg [more.jpg …]` runs real photos through the
 * production image pipeline (the same sharp settings as the API; no upload, no network) and
 * prints each variant's size. Use it on your own phone photos to check variant sizes and the
 * CDN budget. Settings come from `IMAGE_WEBP_QUALITY` and `IMAGE_MAX_PIXELS` (API defaults).
 * @param {string[]} files
 */
export async function measure(files) {
  const processor = createSharpProcessor({
    maxPixels: Number(process.env.IMAGE_MAX_PIXELS ?? 50_000_000),
    quality: Number(process.env.IMAGE_WEBP_QUALITY ?? 80),
  });
  const rows = [];
  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path the operator passed
    const buffer = await readFile(file);
    const started = performance.now();
    const { variants, source } = await processor.process(buffer);
    const ms = Math.round(performance.now() - started);
    const w400 = variants.get('w400');
    const w1080 = variants.get('w1080');
    rows.push({
      file: basename(file),
      source: `${source.width}×${source.height} ${source.format}`,
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path
      inputKB: Math.round((await stat(file)).size / 102.4) / 10,
      w400: `${w400?.width}×${w400?.height} ${Math.round((w400?.data.length ?? 0) / 102.4) / 10} KB`,
      w1080: `${w1080?.width}×${w1080?.height} ${Math.round((w1080?.data.length ?? 0) / 102.4) / 10} KB`,
      ms,
    });
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    process.stderr.write('usage: node scripts/measure-variants.js photo.jpg [more.jpg …]\n');
    process.exitCode = 2;
  } else {
    measure(files)
      .then((rows) => {
        for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
      })
      .catch((error) => {
        process.stderr.write(
          `measure failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      });
  }
}
