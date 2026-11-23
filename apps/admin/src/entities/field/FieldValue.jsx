// @ts-check
import { Badge } from '@vouch/ui-web';

/**
 * One value in a panel, rendered by the field's `kind`. Text is escaped by React; images are
 * staff-only signed URLs and get a text alternative.
 * @param {{ value: unknown, kind: 'text' | 'timestamp' | 'status' | 'user' | 'image' | 'json', label: string }} props
 */
export function FieldValue({ value, kind, label }) {
  if (value === null || value === undefined || value === '')
    return <span className="a-muted">—</span>;
  switch (kind) {
    case 'timestamp':
      return <time dateTime={String(value)}>{new Date(String(value)).toLocaleString()}</time>;
    case 'status':
      return (
        <Badge
          tone={value === true || value === 'open' || value === 'active' ? 'accent' : 'neutral'}
        >
          {String(value)}
        </Badge>
      );
    case 'user':
      return <code>{String(value)}</code>;
    case 'image':
      return (
        <img
          className="a-thumb"
          src={String(value)}
          alt={label}
          width={120}
          height={150}
          loading="lazy"
        />
      );
    case 'json':
      // Scrollable, so keyboard users can focus and scroll it (axe: scrollable-region-focusable).
      return (
        <pre className="a-json" tabIndex={0} aria-label={label}>
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    default:
      return <span>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>;
  }
}
