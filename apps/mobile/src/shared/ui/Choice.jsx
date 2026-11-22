// @ts-check
import { useTheme } from '@vouch/ui-native';
import { Pressable, Text } from 'react-native';

/**
 * A selectable option (radio or checkbox semantics), 44 pt high.
 * @param {{ label: string, selected: boolean, onPress: () => void, kind?: 'radio' | 'checkbox' }} props
 */
export function Choice({ label, selected, onPress, kind = 'radio' }) {
  const { colors, radius, space, minTouchTarget } = useTheme();
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: minTouchTarget,
        justifyContent: 'center',
        paddingHorizontal: space[4],
        marginBottom: space[2],
        borderRadius: radius.md,
        borderWidth: 2,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.surface : colors.background,
      }}
    >
      <Text style={{ color: colors.text, fontWeight: selected ? '700' : '400' }}>{label}</Text>
    </Pressable>
  );
}
