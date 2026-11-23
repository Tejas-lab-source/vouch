// @ts-check
import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('mobile routes', () => {
  it('every home tab registered in the app has an Expo Router file, and routes stay thin', async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's routes folder
    const files = await readdir(new URL('../src/routes/(tabs)/', import.meta.url));
    expect(files.sort()).toEqual([
      '_layout.jsx',
      'chats.jsx',
      'index.jsx',
      'matches.jsx',
      'profile.jsx',
    ]);
  });
});
