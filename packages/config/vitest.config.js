// @ts-check
import { defineConfig, mergeConfig } from 'vitest/config';
import preset from './vitest.preset.js';

export default mergeConfig(preset, defineConfig({}));
