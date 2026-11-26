// @ts-check
import { describe, expect, it } from 'vitest';
import {
  contrast,
  CONTRAST_PAIRS,
  cssVariables,
  dark,
  light,
  radius,
  space,
  THEME_PAIRS,
  themes,
  type,
} from '../src/index.js';

describe('design tokens', () => {
  it.each(Object.entries(themes))(
    'every required pair meets WCAG AA in the %s theme',
    (name, theme) => {
      const colours = new Map(Object.entries(theme));
      const ratio = (/** @type {string} */ fg, /** @type {string} */ bg) =>
        contrast(String(colours.get(fg)), String(colours.get(bg)));
      const pairs = [
        ...CONTRAST_PAIRS,
        ...(name === 'dark' ? THEME_PAIRS.dark : THEME_PAIRS.light),
      ];
      const failures = pairs
        .filter(([fg, bg, min]) => ratio(fg, bg) < min)
        .map(([fg, bg, min]) => `${fg}/${bg} ${ratio(fg, bg).toFixed(2)} < ${min}`);
      expect(failures).toEqual([]);
    },
  );

  it('keeps the spec colours of docs/design/design-system.md', () => {
    const spec = (/** @type {import('../src/index.js').Theme} */ t) => [
      t.primary,
      t.secondary,
      t.background,
      t.surface,
      t.text,
      t.textMuted,
      t.success,
      t.danger,
    ];
    expect(spec(light)).toEqual([
      '#D62828',
      '#F8D7DA',
      '#FFF7F0',
      '#FFFFFF',
      '#1F2937',
      '#6B7280',
      '#16A34A',
      '#DC2626',
    ]);
    expect(spec(dark)).toEqual([
      '#D62828',
      '#3B1F1F',
      '#0B0B0F',
      '#1F1F24',
      '#FFFFFF',
      '#9CA3AF',
      '#16A34A',
      '#DC2626',
    ]);
  });

  it('keeps the spec type, spacing and radii', () => {
    expect([type.h1.size, type.h1.weight, type.h2.size, type.h2.weight]).toEqual([
      30, 700, 20, 600,
    ]);
    expect([type.body.size, type.caption.size, type.caption.weight]).toEqual([15, 12, 500]);
    expect(Object.values(space).slice(1)).toEqual([4, 8, 12, 16, 24, 32, 40, 48]);
    expect([radius.card, radius.button, radius.input, radius.chip, radius.modal]).toEqual([
      16, 24, 16, 20, 24,
    ]);
  });

  it('both themes define the same semantic keys', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('contrast is computed per WCAG (black on white is 21:1)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
  });

  it('emits CSS variables for both themes, fonts, shadows and reduced motion', () => {
    const css = cssVariables();
    expect(css).toContain('--color-primary: #D62828;');
    expect(css).toContain('--color-background: #0B0B0F;');
    expect(css).toContain("[data-theme='dark']");
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('--touch-target: 44px;');
    expect(css).toContain("--font-heading: 'Poppins'");
    expect(css).toContain('--shadow-card: 0 6px 16px rgba(0,0,0,0.10);');
  });
});
