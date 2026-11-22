// @ts-check
import { describe, expect, it } from 'vitest';
import { contrast, CONTRAST_PAIRS, cssVariables, dark, light, themes } from '../src/index.js';

describe('design tokens', () => {
  it.each(Object.entries(themes))(
    'every required pair meets WCAG AA in the %s theme',
    (_name, theme) => {
      const colours = new Map(Object.entries(theme));
      const ratio = (/** @type {string} */ fg, /** @type {string} */ bg) =>
        contrast(String(colours.get(fg)), String(colours.get(bg)));
      const failures = CONTRAST_PAIRS.filter(([fg, bg, min]) => ratio(fg, bg) < min).map(
        ([fg, bg, min]) => `${fg}/${bg} ${ratio(fg, bg).toFixed(2)} < ${min}`,
      );
      expect(failures).toEqual([]);
    },
  );

  it('both themes define the same semantic keys', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('contrast is computed per WCAG (black on white is 21:1)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
  });

  it('emits CSS variables for both themes and reduced motion', () => {
    const css = cssVariables();
    expect(css).toContain('--color-accent: #4338ca;');
    expect(css).toContain("[data-theme='dark']");
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('--touch-target: 44px;');
  });
});
