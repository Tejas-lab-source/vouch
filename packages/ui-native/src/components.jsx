// @ts-check
import { t } from '@vouch/i18n';
import { wordmark } from '@vouch/ui-tokens';
import {
  CircleAlert,
  CircleCheck,
  Clock,
  ShieldCheck,
  X as XIcon,
  XCircle,
} from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal as RNModal,
  Pressable,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import { Path, Svg } from 'react-native-svg';
import { useTheme } from './theme.js';

/**
 * React Native components on the same tokens as the web kit (design update: Direction E,
 * docs/design/design-system.md). Every control is at least 44 pt, exposes an accessibility
 * role and state, and reads its colours, fonts and shadows from the theme.
 */

/**
 * Text in a type style (`h1`, `h2`, `body`, `label`, `caption`), in the theme's text colour
 * unless `color` is given. Headings are announced as headers.
 * @param {import('react-native').TextProps & { variant?: 'h1' | 'h2' | 'body' | 'label' | 'caption', color?: string, muted?: boolean, weight?: 400 | 500 | 600 | 700 }} props
 */
export function Text({ variant = 'body', color, muted = false, weight, style, ...rest }) {
  const { colors, font } = useTheme();
  const heading = variant === 'h1' || variant === 'h2';
  return (
    <RNText
      accessibilityRole={heading ? 'header' : rest.accessibilityRole}
      style={[
        font(variant, weight),
        { color: color ?? (muted ? colors.textMuted : colors.text) },
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * A Lucide icon at the design stroke (1.8), hidden from screen readers.
 * @param {{ icon: import('react').ComponentType<any>, size?: number, color?: string }} props
 */
export function Icon({ icon: Glyph, size, color }) {
  const { colors, icon } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Glyph size={size ?? icon.size} color={color ?? colors.text} strokeWidth={icon.strokeWidth} />
    </View>
  );
}

/**
 * The button colours per variant and state (normal, pressed, disabled).
 * @param {import('./theme.js').NativeTheme['colors']} c
 * @param {'primary' | 'secondary' | 'danger' | 'ghost'} variant
 * @param {boolean} pressed
 * @param {boolean} disabled
 */
function buttonColours(c, variant, pressed, disabled) {
  if (variant === 'primary') {
    return {
      bg: disabled ? c.primaryDisabled : pressed ? c.primaryPressed : c.primary,
      fg: c.onPrimary,
      border: 'transparent',
    };
  }
  if (variant === 'danger') {
    return { bg: pressed ? c.dangerPressed : c.danger, fg: c.onDanger, border: 'transparent' };
  }
  if (variant === 'secondary') {
    return {
      bg: pressed ? c.secondary : c.surface,
      fg: pressed ? c.primaryOnSecondary : c.primaryText,
      border: c.primaryText,
    };
  }
  return {
    bg: pressed ? c.secondary : 'transparent',
    fg: pressed ? c.primaryOnSecondary : c.primaryText,
    border: 'transparent',
  };
}

/**
 * @param {{ title: string, onPress?: () => void, variant?: 'primary' | 'secondary' | 'danger' | 'ghost', loading?: boolean, disabled?: boolean, testID?: string, accessibilityLabel?: string, icon?: import('react').ComponentType<any>, block?: boolean, compact?: boolean }} props
 *   `accessibilityLabel` names icon-like buttons for screen readers; `icon` is a Lucide icon
 *   before the title (decorative); `compact` is a smaller ghost-style row action.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  testID,
  accessibilityLabel,
  icon,
  block = false,
  compact = false,
}) {
  const { colors, radius: r, minTouchTarget, space: sp, font, shadow } = useTheme();
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => {
        const c = buttonColours(colors, variant, pressed, inactive);
        const filled = variant === 'primary' || variant === 'danger';
        return {
          minHeight: compact ? minTouchTarget : 48,
          minWidth: minTouchTarget,
          paddingHorizontal: compact ? sp[3] : sp[5],
          borderRadius: r.button,
          backgroundColor: c.bg,
          borderWidth: variant === 'secondary' ? 1.5 : 0,
          borderColor: c.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: sp[2],
          alignSelf: block ? 'stretch' : undefined,
          opacity: inactive && variant !== 'primary' ? 0.5 : 1,
          transform: [{ scale: pressed && !inactive ? 0.98 : 1 }],
          ...(filled && !inactive ? shadow.button : {}),
        };
      }}
    >
      {({ pressed }) => {
        const c = buttonColours(colors, variant, pressed, inactive);
        return (
          <>
            {loading ? (
              <ActivityIndicator color={c.fg} />
            ) : icon ? (
              <Icon icon={icon} size={20} color={c.fg} />
            ) : null}
            <RNText style={{ ...font('label'), color: c.fg }}>{title}</RNText>
          </>
        );
      }}
    </Pressable>
  );
}

/**
 * A round icon-only button (the deck's Pass and Like). `label` names it for screen readers.
 * @param {{ icon: import('react').ComponentType<any>, label: string, onPress?: () => void, variant?: 'primary' | 'secondary' | 'ghost', size?: 'md' | 'lg', disabled?: boolean }} props
 */
export function IconButton({ icon, label, onPress, variant = 'ghost', size = 'md', disabled }) {
  const { colors, shadow } = useTheme();
  const box = size === 'lg' ? 68 : variant === 'ghost' ? 44 : 56;
  const fg = variant === 'primary' ? colors.onPrimary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: box,
        height: box,
        borderRadius: box / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor:
          variant === 'primary'
            ? pressed
              ? colors.primaryPressed
              : colors.primary
            : variant === 'secondary'
              ? colors.surface
              : pressed
                ? colors.secondary
                : 'transparent',
        borderWidth: variant === 'secondary' ? 1.5 : 0,
        borderColor: colors.borderSubtle,
        opacity: disabled ? 0.5 : 1,
        transform: [{ scale: pressed ? 0.94 : 1 }],
        ...(variant === 'ghost' ? {} : shadow.card),
      })}
    >
      <Icon icon={icon} size={size === 'lg' ? 30 : 24} color={fg} />
    </Pressable>
  );
}

/** @param {{ label: string, error?: string | null, hint?: string } & import('react-native').TextInputProps} props */
export function Input({ label, error, hint, style, ...rest }) {
  const { colors, radius: r, space: sp, font } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: sp[4] }}>
      <RNText style={{ ...font('label'), color: colors.text, marginBottom: sp[2] }}>{label}</RNText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.textMuted}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          {
            ...font('body'),
            minHeight: 48,
            paddingHorizontal: sp[4],
            paddingVertical: sp[3],
            borderWidth: focused ? 2 : 1,
            borderRadius: r.input,
            borderColor: error ? colors.dangerText : focused ? colors.focus : colors.border,
            color: colors.text,
            backgroundColor: colors.surface,
          },
          style,
        ]}
        {...rest}
      />
      {hint ? (
        <RNText style={{ ...font('caption'), color: colors.textMuted, marginTop: sp[1] }}>
          {hint}
        </RNText>
      ) : null}
      {error ? (
        <RNText
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ ...font('caption', 600), color: colors.dangerText, marginTop: sp[1] }}
        >
          {error}
        </RNText>
      ) : null}
    </View>
  );
}

/**
 * The six-digit code: one numeric field (platform one-time-code autofill, one announcement)
 * drawn as six boxes.
 * @param {{ label: string, value: string, onChange: (value: string) => void, length?: number, error?: string | null }} props
 */
export function OtpInput({ label, value, onChange, length = 6, error }) {
  const { colors, radius: r, space: sp, font } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: sp[4] }}>
      <RNText style={{ ...font('label'), color: colors.text, marginBottom: sp[2] }}>{label}</RNText>
      {/* The real field lies over the boxes, so a tap anywhere on them focuses it. */}
      <View style={{ flexDirection: 'row', gap: sp[2] }}>
        {Array.from({ length }, (_, i) => {
          const active = focused && i === Math.min(value.length, length - 1);
          return (
            <View
              key={i}
              style={{
                flex: 1,
                height: 56,
                borderRadius: r.input,
                borderWidth: active ? 2 : 1,
                borderColor: error ? colors.dangerText : active ? colors.focus : colors.border,
                backgroundColor: colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={{ ...font('h2'), color: colors.text }}>{value.charAt(i)}</RNText>
            </View>
          );
        })}
        <TextInput
          accessibilityLabel={label}
          value={value}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={length}
          caretHidden
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.02,
            color: 'transparent',
          }}
        />
      </View>
      {error ? (
        <RNText
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ ...font('caption', 600), color: colors.dangerText, marginTop: sp[1] }}
        >
          {error}
        </RNText>
      ) : null}
    </View>
  );
}

/** @param {{ uri?: string | null, alt: string, name?: string, size?: number, ring?: boolean }} props */
export function Avatar({ uri, alt, name = '', size = 48, ring = false }) {
  const { colors, font } = useTheme();
  const initials = name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    ...(ring ? { borderWidth: 3, borderColor: colors.surface } : {}),
  };
  return uri ? (
    <Image source={{ uri }} accessibilityLabel={alt} style={frame} />
  ) : (
    <View
      accessibilityRole="image"
      accessibilityLabel={alt}
      style={{
        ...frame,
        backgroundColor: colors.secondary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <RNText
        style={{ ...font('label'), fontSize: Math.max(13, size / 3), color: colors.onSecondary }}
      >
        {initials}
      </RNText>
    </View>
  );
}

/** @param {{ children: import('react').ReactNode, padded?: boolean }} props */
export function Card({ children, padded = true }) {
  const { colors, radius: r, space: sp, shadow } = useTheme();
  return (
    <View
      style={{
        padding: padded ? sp[4] : 0,
        borderWidth: 1,
        borderColor: colors.borderSubtle,
        borderRadius: r.card,
        backgroundColor: colors.surface,
        ...shadow.card,
      }}
    >
      {children}
    </View>
  );
}

/**
 * A bottom sheet (React Native Modal); the system back gesture closes it.
 * @param {{ open: boolean, onClose: () => void, title: string, children: import('react').ReactNode }} props
 */
export function Sheet({ open, onClose, title, children }) {
  const { colors, radius: r, space: sp, shadow } = useTheme();
  return (
    <RNModal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      aria-label={title}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim }}>
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: r.modal,
            borderTopRightRadius: r.modal,
            padding: sp[5],
            paddingTop: sp[3],
            gap: sp[3],
            ...shadow.modal,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.borderSubtle,
            }}
          />
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text variant="h2" style={{ flex: 1 }}>
              {title}
            </Text>
            <IconButton icon={XIcon} label={t('ui.modal.close')} onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </RNModal>
  );
}

/** @param {{ message: string, tone?: 'info' | 'success' | 'error', onDismiss?: () => void }} props */
export function Toast({ message, tone = 'info', onDismiss }) {
  const { colors, radius: r, space: sp, shadow } = useTheme();
  const glyph = tone === 'error' ? CircleAlert : tone === 'success' ? CircleCheck : null;
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp[3],
        paddingVertical: sp[2],
        paddingLeft: sp[4],
        paddingRight: sp[2],
        minHeight: 52,
        borderRadius: r.card,
        borderWidth: 1,
        borderColor: tone === 'error' ? colors.dangerText : colors.borderSubtle,
        backgroundColor: colors.surface,
        ...shadow.card,
      }}
    >
      {glyph ? (
        <Icon icon={glyph} color={tone === 'error' ? colors.dangerText : colors.successText} />
      ) : null}
      <Text weight={500} style={{ flex: 1 }}>
        {message}
      </Text>
      {onDismiss ? (
        <IconButton icon={XIcon} label={t('ui.toast.dismiss')} onPress={onDismiss} />
      ) : null}
    </View>
  );
}

/** @param {{ title: string, body?: string, action?: import('react').ReactNode, art?: import('react').ReactNode }} props */
export function EmptyState({ title, body, action, art }) {
  const { space: sp } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: sp[6], gap: sp[3] }}>
      {art ?? null}
      <Text variant="h2" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text muted style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      {action ?? null}
    </View>
  );
}

/** @param {{ width?: import('react-native').DimensionValue, height?: number, round?: boolean }} props */
export function Skeleton({ width = '100%', height = 16, round = false }) {
  const { colors, radius: r } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width,
        height,
        borderRadius: round ? height / 2 : r.sm,
        backgroundColor: colors.surfaceMuted,
      }}
    />
  );
}

/** @param {{ title: string, subtitle?: string, leading?: import('react').ReactNode, trailing?: import('react').ReactNode, onPress?: () => void, accessibilityLabel?: string }} props */
export function ListItem({ title, subtitle, leading, trailing, onPress, accessibilityLabel }) {
  const { colors, space: sp, minTouchTarget, radius: r } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      // One announcement for the row (Phase 14): the title, then the subtitle.
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp[3],
        minHeight: Math.max(minTouchTarget, 64),
        paddingHorizontal: sp[3],
        paddingVertical: sp[2],
        borderRadius: r.card,
        backgroundColor: pressed ? colors.secondary : 'transparent',
      })}
    >
      {leading ?? null}
      <View style={{ flex: 1 }}>
        <Text variant="label" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" muted numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? null}
    </Pressable>
  );
}

/** A count or short tag. @param {{ children: import('react').ReactNode, tone?: 'neutral' | 'accent' | 'danger', label?: string }} props */
export function Badge({ children, tone = 'neutral', label }) {
  const { colors, radius: r, space: sp, font } = useTheme();
  const [background, foreground] =
    tone === 'accent'
      ? [colors.primary, colors.onPrimary]
      : tone === 'danger'
        ? [colors.danger, colors.onDanger]
        : [colors.secondary, colors.onSecondary];
  return (
    <View
      accessibilityLabel={label}
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: sp[2],
        borderRadius: r.pill,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <RNText style={{ ...font('caption', 600), color: foreground }}>{children}</RNText>
    </View>
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
 * A status pill: verified and approved green, pending review amber, rejected red.
 * @param {{ status: 'verified' | 'approved' | 'pending' | 'rejected', children: string }} props
 */
export function StatusBadge({ status, children }) {
  const { colors, radius: r, space: sp, font } = useTheme();
  const [bg, fg] =
    status === 'pending'
      ? [colors.warningSoft, colors.warningText]
      : status === 'rejected'
        ? [colors.dangerSoft, colors.dangerText]
        : [colors.successSoft, colors.successText];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: sp[1],
        paddingVertical: 2,
        paddingHorizontal: sp[2],
        borderRadius: r.pill,
        backgroundColor: bg,
      }}
    >
      <Icon icon={/** @type {any} */ (STATUS_ICONS.get(status))} size={14} color={fg} />
      <RNText style={{ ...font('caption', 600), color: fg }}>{children}</RNText>
    </View>
  );
}

/** A pale pink, rounded chip. @param {{ children: string, icon?: import('react').ComponentType<any> }} props */
export function Chip({ children, icon }) {
  const { colors, radius: r, space: sp, font } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: sp[1],
        minHeight: 32,
        paddingHorizontal: sp[3],
        borderRadius: r.chip,
        backgroundColor: colors.secondary,
      }}
    >
      {icon ? <Icon icon={icon} size={14} color={colors.onSecondary} /> : null}
      <RNText style={{ ...font('caption', 600), color: colors.onSecondary }}>{children}</RNText>
    </View>
  );
}

/**
 * The "Vouch" wordmark with its heart (SVG paths from the tokens). The letters use the brand
 * text colour of the theme; the heart is always primary.
 * @param {{ height?: number }} props
 */
export function Wordmark({ height = 32 }) {
  const { colors } = useTheme();
  const [, , w, h] = wordmark.viewBox.split(' ').map(Number);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t('app.name')}>
      <Svg viewBox={wordmark.viewBox} height={height} width={(height * (w ?? 1)) / (h ?? 1)}>
        <Path d={wordmark.letters} fill={colors.primaryText} />
        <Path d={wordmark.heart} fill={colors.primary} />
      </Svg>
    </View>
  );
}
