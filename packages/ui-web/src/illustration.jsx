// @ts-check

/**
 * The design's illustrations (decorative: empty alt text, lazy-loaded, never behind text).
 * The files in `assets/` are clearly-marked placeholders until the final art arrives: replace
 * the SVG and keep the name.
 */
const FILES = new Map([
  ['campus', new URL('../assets/campus-placeholder.svg', import.meta.url).href],
  ['pattern', new URL('../assets/pattern-placeholder.svg', import.meta.url).href],
]);

/** @param {{ name: 'campus' | 'pattern', className?: string, width?: number, height?: number }} props */
export function Illustration({ name, className, width = 640, height = 260 }) {
  return (
    <img
      className={['v-illustration', className].filter(Boolean).join(' ')}
      src={FILES.get(name)}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      data-placeholder="true"
    />
  );
}
