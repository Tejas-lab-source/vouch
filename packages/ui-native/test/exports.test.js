// @ts-check
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * React Native components render only in a native runtime (checked by `expo export` and the
 * owner's device checks); here we pin the kit's surface so it stays in step with ui-web.
 */
describe('ui-native', () => {
  it('exports the same components as the web kit (Sheet stands for Modal)', async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this package's own source
    const native = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
    for (const name of [
      'Avatar',
      'Badge',
      'Button',
      'Card',
      'EmptyState',
      'Input',
      'ListItem',
      'OtpInput',
      'Sheet',
      'Skeleton',
      'Toast',
      'useTheme',
      'StatusBadge',
      'Chip',
      'IconButton',
      'Wordmark',
      'Icon',
    ]) {
      expect(native).toContain(name);
    }
  });

  it('reads colours and fonts only from the theme (no literal colours in components)', async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this package's own source
    const source = await readFile(new URL('../src/components.jsx', import.meta.url), 'utf8');
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g) ?? []).toEqual([]);
  });

  it('every pressable control declares a role and a 44 pt minimum', async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this package's own source
    const source = await readFile(new URL('../src/components.jsx', import.meta.url), 'utf8');
    expect(source.match(/<Pressable/g)?.length).toBe(3);
    expect(source.match(/accessibilityRole=/g)?.length).toBeGreaterThanOrEqual(9);
    expect(source).toContain('minWidth: minTouchTarget');
    expect(source).toContain('Math.max(minTouchTarget, 64)');
  });
});
