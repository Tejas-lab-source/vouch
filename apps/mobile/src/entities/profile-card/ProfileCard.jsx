// @ts-check
import { t } from '@vouch/i18n';
import { Button, useTheme } from '@vouch/ui-native';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

/**
 * Someone's profile card: the 400 px photo in the deck, every photo at 1080 px in the details.
 * expo-image caches in memory and on disk.
 * @param {{ card: import('@vouch/features-core').ProfileCard, badges?: import('react').ReactNode, actions?: import('react').ReactNode }} props
 */
export function ProfileCard({ card, badges = null, actions = null }) {
  const { colors, space, radius, type } = useTheme();
  const [open, setOpen] = useState(false);
  const label = t('deck.card.label', { name: card.name, age: card.age });
  const main = card.photos.at(0);
  return (
    <View
      accessibilityLabel={label}
      style={{
        borderRadius: radius.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      {main ? (
        <Image
          source={{ uri: main.w400 }}
          accessibilityLabel={t('deck.card.photo', { n: 1, name: card.name })}
          cachePolicy="memory-disk"
          contentFit="cover"
          style={{ width: '100%', aspectRatio: 4 / 5 }}
        />
      ) : null}
      <View style={{ padding: space[4] }}>
        <Text
          accessibilityRole="header"
          style={{ color: colors.text, fontSize: type.title.size, fontWeight: '700' }}
        >
          {label}
        </Text>
        <Text style={{ color: colors.textMuted, marginBottom: space[2] }}>{card.collegeName}</Text>
        {badges}
        <Button
          variant="ghost"
          title={open ? t('deck.card.less') : t('deck.card.more')}
          onPress={() => setOpen(!open)}
        />
        {open ? (
          <ScrollView style={{ maxHeight: 480 }}>
            {card.bio ? (
              <Text style={{ color: colors.text, marginBottom: space[2] }}>{card.bio}</Text>
            ) : null}
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
