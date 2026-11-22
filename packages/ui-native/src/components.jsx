// @ts-check
import { t } from '@vouch/i18n';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal as RNModal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from './theme.js';

/**
 * React Native components on the same tokens as the web kit (Phase 11). Every control is at
 * least 44 pt, exposes an accessibility role and state, and reads its colours from the theme.
 */

/**
 * @param {{ title: string, onPress?: () => void, variant?: 'primary' | 'secondary' | 'danger' | 'ghost', loading?: boolean, disabled?: boolean, testID?: string }} props
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  testID,
}) {
  const { colors, radius: r, minTouchTarget, type: ty, space: sp } = useTheme();
  const background = new Map([
    ['primary', colors.accent],
    ['secondary', colors.surface],
    ['danger', colors.danger],
    ['ghost', 'transparent'],
  ]).get(variant);
  const foreground = new Map([
    ['primary', colors.onAccent],
    ['secondary', colors.text],
    ['danger', colors.onDanger],
    ['ghost', colors.accent],
  ]).get(variant);
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={{
        minHeight: minTouchTarget,
        minWidth: minTouchTarget,
        paddingHorizontal: sp[5],
        borderRadius: r.pill,
        backgroundColor: background,
        borderWidth: variant === 'secondary' ? 2 : 0,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        opacity: inactive ? 0.6 : 1,
      }}
    >
      {loading ? <ActivityIndicator color={foreground} style={{ marginRight: sp[2] }} /> : null}
      <Text style={{ color: foreground, fontSize: ty.body.size, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

/** @param {{ label: string, error?: string | null, hint?: string } & import('react-native').TextInputProps} props */
export function Input({ label, error, hint, ...rest }) {
  const { colors, radius: r, minTouchTarget, type: ty, space: sp } = useTheme();
  return (
    <View style={{ marginBottom: sp[4] }}>
      <Text
        style={{
          color: colors.text,
          fontSize: ty.label.size,
          fontWeight: '600',
          marginBottom: sp[1],
        }}
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.textMuted}
        style={{
          minHeight: minTouchTarget,
          paddingHorizontal: sp[3],
          borderWidth: 2,
          borderRadius: r.md,
          borderColor: error ? colors.danger : colors.border,
          color: colors.text,
          backgroundColor: colors.background,
          fontSize: ty.body.size,
        }}
        {...rest}
      />
      {hint ? (
        <Text style={{ color: colors.textMuted, fontSize: ty.caption.size }}>{hint}</Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: colors.danger, fontSize: ty.label.size }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The six-digit code: one numeric field with the platform's one-time-code autofill.
 * @param {{ label: string, value: string, onChange: (value: string) => void, length?: number, error?: string | null }} props
 */
export function OtpInput({ label, value, onChange, length = 6, error }) {
  return (
    <Input
      label={label}
      value={value}
      error={error}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      maxLength={length}
      onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
      style={{ letterSpacing: 12 }}
    />
  );
}

/** @param {{ uri?: string | null, alt: string, name?: string, size?: number }} props */
export function Avatar({ uri, alt, name = '', size = 48 }) {
  const { colors } = useTheme();
  const initials = name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return uri ? (
    <Image
      source={{ uri }}
      accessibilityLabel={alt}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  ) : (
    <View
      accessibilityRole="image"
      accessibilityLabel={alt}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.text, fontWeight: '600' }}>{initials}</Text>
    </View>
  );
}

/** @param {{ children: import('react').ReactNode }} props */
export function Card({ children }) {
  const { colors, radius: r, space: sp } = useTheme();
  return (
    <View
      style={{
        padding: sp[4],
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: r.lg,
        backgroundColor: colors.surface,
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
  const { colors, radius: r, space: sp, type: ty } = useTheme();
  return (
    <RNModal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: r.lg,
            borderTopRightRadius: r.lg,
            padding: sp[4],
          }}
        >
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: colors.text, fontSize: ty.title.size, fontWeight: '700' }}
            >
              {title}
            </Text>
            <Button title={t('ui.modal.close')} variant="ghost" onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </RNModal>
  );
}

/** @param {{ message: string, tone?: 'info' | 'error', onDismiss?: () => void }} props */
export function Toast({ message, tone = 'info', onDismiss }) {
  const { colors, radius: r, space: sp } = useTheme();
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: sp[3],
        borderRadius: r.md,
        backgroundColor: tone === 'error' ? colors.danger : colors.text,
      }}
    >
      <Text style={{ color: tone === 'error' ? colors.onDanger : colors.background, flex: 1 }}>
        {message}
      </Text>
      {onDismiss ? (
        <Button title={t('ui.toast.dismiss')} variant="ghost" onPress={onDismiss} />
      ) : null}
    </View>
  );
}

/** @param {{ title: string, body?: string, action?: import('react').ReactNode }} props */
export function EmptyState({ title, body, action }) {
  const { colors, space: sp, type: ty } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: sp[7] }}>
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text,
          fontSize: ty.title.size,
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text style={{ color: colors.textMuted, marginTop: sp[2], textAlign: 'center' }}>
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

/** @param {{ title: string, subtitle?: string, leading?: import('react').ReactNode, trailing?: import('react').ReactNode, onPress?: () => void }} props */
export function ListItem({ title, subtitle, leading, trailing, onPress }) {
  const { colors, space: sp, minTouchTarget } = useTheme();
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: minTouchTarget,
        paddingHorizontal: sp[4],
        paddingVertical: sp[2],
        backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
      }}
    >
      {leading ? <View style={{ marginRight: sp[3] }}>{leading}</View> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{title}</Text>
        {subtitle ? <Text style={{ color: colors.textMuted }}>{subtitle}</Text> : null}
      </View>
      {trailing ?? null}
    </Pressable>
  );
}

/** @param {{ children: import('react').ReactNode, tone?: 'neutral' | 'accent' | 'danger', label?: string }} props */
export function Badge({ children, tone = 'neutral', label }) {
  const { colors, radius: r, space: sp, type: ty } = useTheme();
  const [background, foreground] =
    tone === 'accent'
      ? [colors.accent, colors.onAccent]
      : tone === 'danger'
        ? [colors.danger, colors.onDanger]
        : [colors.surfaceMuted, colors.text];
  return (
    <View
      accessibilityLabel={label}
      style={{ paddingHorizontal: sp[2], borderRadius: r.pill, backgroundColor: background }}
    >
      <Text style={{ color: foreground, fontSize: ty.caption.size, fontWeight: '600' }}>
        {children}
      </Text>
    </View>
  );
}
