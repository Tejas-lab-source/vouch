// @ts-check
import { Icon, useTheme } from '@vouch/ui-native';
import { Check } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';

/**
 * A selectable option (radio or checkbox semantics) drawn as a pill: pink and outlined in red
 * when selected. At least 44 pt high. `wide` makes it a full-width row (long labels).
 * @param {{ label: string, selected: boolean, onPress: () => void, kind?: 'radio' | 'checkbox', wide?: boolean }} props
 */
export function Choice({ label, selected, onPress, kind = 'radio', wide = false }) {
  const { colors, radius, space, minTouchTarget, font } = useTheme();
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        minHeight: minTouchTarget,
        alignSelf: wide ? 'stretch' : 'flex-start',
        paddingHorizontal: space[4],
        marginBottom: space[2],
        marginRight: wide ? 0 : space[2],
        borderRadius: wide ? radius.input : radius.chip,
        borderWidth: 1.5,
        borderColor: selected ? colors.primaryText : colors.borderSubtle,
        backgroundColor: selected || pressed ? colors.secondary : colors.surface,
      })}
    >
      {selected ? <Icon icon={Check} size={16} color={colors.primaryText} /> : null}
      <Text style={{ ...font('label', selected ? 600 : 500), color: colors.text }}>{label}</Text>
    </Pressable>
  );
}
