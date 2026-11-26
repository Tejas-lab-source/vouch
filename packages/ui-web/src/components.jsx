// @ts-check
import { t } from '@vouch/i18n';
import { icon as iconToken, wordmark } from '@vouch/ui-tokens';
import { CircleAlert, CircleCheck, Clock, ShieldCheck, X as XIcon, XCircle } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

/** @param {...(string | false | null | undefined)} names */
const cx = (...names) => names.filter(Boolean).join(' ');

/**
 * A button. At least 44 px tall; a visible focus ring; `loading` keeps the width and announces
 * the busy state.
 * `icon` is a Lucide icon shown before the label (decorative: the label names the button).
 * @param {import('react').ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost', loading?: boolean, block?: boolean, icon?: import('react').ComponentType<any> }} props
 */
export function Button({
  variant = 'primary',
  loading = false,
  block = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      className={cx('v-button', `v-button--${variant}`, block && 'v-button--block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="v-spinner" aria-hidden="true" />
      ) : icon ? (
        <Icon icon={icon} size={20} />
      ) : null}
      <span className="v-button__label">{children}</span>
    </button>
  );
}

/**
 * A labelled text field. The hint and the error are tied to the input with
 * `aria-describedby`; an error sets `aria-invalid`.
 * @param {import('react').InputHTMLAttributes<HTMLInputElement> & { label: string, hint?: string, error?: string | null }} props
 */
export function Input({ label, hint, error, id, className, ...rest }) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cx('v-field', className)}>
      <label className="v-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="v-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="v-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="v-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A six-digit code field: one input (paste and SMS/email autofill work, screen readers read
 * one field), shown as separate boxes.
 * @param {{ label: string, value: string, onChange: (value: string) => void, length?: number, error?: string | null, autoFocus?: boolean, disabled?: boolean }} props
 */
export function OtpInput({ label, value, onChange, length = 6, error, autoFocus, disabled }) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="v-field">
      <label className="v-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="v-otp">
        <input
          id={id}
          className="v-otp__input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={`[0-9]{${length}}`}
          maxLength={length}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, length))}
        />
        <div className="v-otp__boxes" aria-hidden="true">
          {Array.from({ length }, (_, i) => (
            <span key={i} className={cx('v-otp__box', i === value.length && 'v-otp__box--active')}>
              {value.charAt(i)}
            </span>
          ))}
        </div>
      </div>
      {error ? (
        <p id={errorId} className="v-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A round photo, or initials when there is none. `alt` is required (empty for decorative).
 * @param {{ src?: string | null, alt: string, name?: string, size?: number }} props
 */
export function Avatar({ src, alt, name = '', size = 48 }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return src ? (
    <img className="v-avatar" src={src} alt={alt} width={size} height={size} />
  ) : (
    <span
      className="v-avatar v-avatar--initials"
      role="img"
      aria-label={alt}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}

/** @param {import('react').HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'article' }} props */
export function Card({ as: Tag = 'div', className, ...rest }) {
  return <Tag className={cx('v-card', className)} {...rest} />;
}

/**
 * A modal dialog (a bottom sheet on narrow screens). Native `<dialog>`: focus moves in, Escape
 * closes, the page behind is inert.
 * @param {{ open: boolean, onClose: () => void, title: string, children: import('react').ReactNode, className?: string }} props
 */
export function Modal({ open, onClose, title, children, className }) {
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cx('v-modal', className)}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="v-modal__header">
        <h2 id={titleId} className="v-modal__title">
          {title}
        </h2>
        <button
          type="button"
          className="v-icon-button"
          aria-label={t('ui.modal.close')}
          onClick={onClose}
        >
          <Icon icon={XIcon} />
        </button>
      </div>
      <div className="v-modal__body">{children}</div>
    </dialog>
  );
}

/**
 * A short notice, announced politely (`role="status"`); errors use `role="alert"`.
 * @param {{ message: string, tone?: 'info' | 'success' | 'error', onDismiss?: () => void }} props
 */
export function Toast({ message, tone = 'info', onDismiss }) {
  return (
    <div className={cx('v-toast', `v-toast--${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'info' ? null : (
        <span className="v-toast__icon">
          <Icon icon={tone === 'error' ? CircleAlert : CircleCheck} size={22} />
        </span>
      )}
      <span className="v-toast__message">{message}</span>
      {onDismiss ? (
        <button
          type="button"
          className="v-icon-button"
          aria-label={t('ui.toast.dismiss')}
          onClick={onDismiss}
        >
          <Icon icon={XIcon} />
        </button>
      ) : null}
    </div>
  );
}

/** @param {{ title: string, body?: string, action?: import('react').ReactNode, art?: import('react').ReactNode }} props */
export function EmptyState({ title, body, action, art }) {
  return (
    <div className="v-empty">
      {art ?? null}
      <h2 className="v-empty__title">{title}</h2>
      {body ? <p className="v-empty__body">{body}</p> : null}
      {action ?? null}
    </div>
  );
}

/** A loading placeholder (hidden from screen readers; pair it with a busy region). @param {{ width?: number | string, height?: number | string, round?: boolean }} props */
export function Skeleton({ width = '100%', height = 16, round = false }) {
  return (
    <span
      className={cx('v-skeleton', round && 'v-skeleton--round')}
      aria-hidden="true"
      style={{ width, height }}
    />
  );
}

/**
 * A row in a list. With `onClick` it is a button (keyboard and screen-reader operable).
 * @param {{ title: string, subtitle?: string, leading?: import('react').ReactNode, trailing?: import('react').ReactNode, onClick?: () => void }} props
 */
export function ListItem({ title, subtitle, leading, trailing, onClick }) {
  const content = (
    <>
      {leading ? <span className="v-list-item__leading">{leading}</span> : null}
      <span className="v-list-item__text">
        <span className="v-list-item__title">{title}</span>
        {subtitle ? <span className="v-list-item__subtitle">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="v-list-item__trailing">{trailing}</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="v-list-item v-list-item--button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="v-list-item">{content}</div>
  );
}

/** A count or short tag. @param {{ children: import('react').ReactNode, tone?: 'neutral' | 'accent' | 'danger', label?: string }} props */
export function Badge({ children, tone = 'neutral', label }) {
  return (
    <span className={cx('v-badge', `v-badge--${tone}`)} aria-label={label}>
      {children}
    </span>
  );
}

/** @type {Map<string, import('react').ComponentType<any>>} */
const STATUS_ICONS = new Map([
  ['verified', ShieldCheck],
  ['approved', CircleCheck],
  ['pending', Clock],
  ['rejected', XCircle],
]);

/**
 * A status pill: verified and approved are green, pending review amber, rejected red. The text
 * carries the meaning; the icon repeats it.
 * @param {{ status: 'verified' | 'approved' | 'pending' | 'rejected', children: import('react').ReactNode }} props
 */
export function StatusBadge({ status, children }) {
  return (
    <span className={cx('v-status', `v-status--${status}`)}>
      <Icon
        icon={/** @type {import('react').ComponentType<any>} */ (STATUS_ICONS.get(status))}
        size={14}
      />
      {children}
    </span>
  );
}

/** A pale pink, rounded chip (a college, a tag). @param {{ children: import('react').ReactNode }} props */
export function Chip({ children }) {
  return <span className="v-chip">{children}</span>;
}

/**
 * A Lucide icon at the design stroke (1.8), hidden from screen readers unless it has a label.
 * @param {{ icon: import('react').ComponentType<any>, size?: number, label?: string, className?: string }} props
 */
export function Icon({ icon: Glyph, size = iconToken.size, label, className }) {
  return (
    <Glyph
      size={size}
      strokeWidth={iconToken.strokeWidth}
      absoluteStrokeWidth={false}
      className={cx('v-icon', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}

/**
 * A round icon-only button (the deck's Pass and Like). The label names it for screen readers
 * and is shown as a tooltip.
 * @param {import('react').ButtonHTMLAttributes<HTMLButtonElement> & { icon: import('react').ComponentType<any>, label: string, variant?: 'primary' | 'secondary' | 'ghost', size?: 'md' | 'lg' }} props
 */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      className={cx('v-round', `v-round--${variant}`, `v-round--${size}`, className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon icon={icon} size={size === 'lg' ? 30 : 22} />
    </button>
  );
}

/**
 * The "Vouch" wordmark with its heart (SVG paths from the tokens; no font needed). The letters
 * use the brand text colour of the theme; the heart is always primary red.
 * @param {{ height?: number, className?: string }} props
 */
export function Wordmark({ height = 32, className }) {
  const [, , w, h] = wordmark.viewBox.split(' ').map(Number);
  return (
    <svg
      className={cx('v-wordmark', className)}
      viewBox={wordmark.viewBox}
      height={height}
      width={Math.round((height * (w ?? 1)) / (h ?? 1))}
      role="img"
      aria-label={t('app.name')}
    >
      <path className="v-wordmark__letters" d={wordmark.letters} />
      <path className="v-wordmark__heart" d={wordmark.heart} />
    </svg>
  );
}
