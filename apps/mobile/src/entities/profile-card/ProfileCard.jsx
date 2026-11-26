// @ts-check
import { t } from '@vouch/i18n';
import { Button, Chip, GraduationCap, Text, useTheme } from '@vouch/ui-native';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

/**
 * Someone's profile card: the 400 px photo, name and age, the college as a chip and the start
 * of the bio; "View profile" shows the whole bio and every photo at 1080 px. Only fields we
 * have are shown. expo-image caches in memory and on disk.
 * @param {{ card: import('@vouch/features-core').ProfileCard, badges?: import('react').ReactNode, actions?: import('react').ReactNode }} props
 */
export function ProfileCard({ card, badges = null, actions = null }) {
  const { colors, space, radius, shadow } = useTheme();
  const [open, setOpen] = useState(false);
  const label = t('deck.card.label', { name: card.name, age: card.age });
  const main = card.photos.at(0);
  // The photo keeps the card, the Pass and Like buttons and the tab bar on one phone screen.
  const { height: screenHeight } = useWindowDimensions();
  const photo = { width: '100%', height: Math.round(screenHeight * 0.46) };
  return (
    <View
      accessibilityLabel={label}
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.borderSubtle,
        backgroundColor: colors.surface,
        ...shadow.card,
      }}
    >
      <View
        style={{
          borderTopLeftRadius: radius.card,
          borderTopRightRadius: radius.card,
          overflow: 'hidden',
        }}
      >
        {main ? (
          <Image
            source={{ uri: main.w400 }}
            accessibilityLabel={t('deck.card.photo', { n: 1, name: card.name })}
            cachePolicy="memory-disk"
            contentFit="cover"
            style={{ ...photo, backgroundColor: colors.surfaceMuted }}
          />
        ) : (
          <View style={{ ...photo, backgroundColor: colors.surfaceMuted }} />
        )}
        {card.photos.length > 1 ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              top: space[3],
              right: space[3],
              paddingHorizontal: space[2],
              paddingVertical: 2,
              borderRadius: radius.pill,
              backgroundColor: colors.scrim,
            }}
          >
            <Text variant="caption" color={colors.onPrimary}>
              1 / {card.photos.length}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: space[4], gap: space[2] }}>
        <Text variant="h2">{label}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          <Chip icon={GraduationCap}>{card.collegeName}</Chip>
          {badges}
        </View>
        {card.bio && !open ? <Text numberOfLines={2}>{card.bio}</Text> : null}
        <View style={{ alignSelf: 'flex-start', marginLeft: -space[3] }}>
          <Button
            variant="ghost"
            compact
            title={open ? t('deck.card.less') : t('deck.card.more')}
            onPress={() => setOpen(!open)}
          />
        </View>
        {open ? (
          <ScrollView style={{ maxHeight: 480 }} focusable>
            {card.bio ? <Text style={{ marginBottom: space[3] }}>{card.bio}</Text> : null}
            {card.photos.map((photo, i) => (
              <Image
                key={photo.w1080}
                source={{ uri: photo.w1080 }}
                accessibilityLabel={t('deck.card.photo', { n: i + 1, name: card.name })}
                cachePolicy="memory-disk"
                contentFit="cover"
                style={{
                  width: '100%',
                  aspectRatio: 4 / 5,
                  marginBottom: space[2],
                  borderRadius: radius.md,
                }}
              />
            ))}
          </ScrollView>
        ) : null}
        {actions}
      </View>
    </View>
  );
}
