// @ts-check
import preset from '@vouch/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(preset, defineConfig({}));
