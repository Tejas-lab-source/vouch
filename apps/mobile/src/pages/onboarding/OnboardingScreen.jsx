// @ts-check
import { MIN_PHOTOS, ONBOARDING_STEPS, useOnboarding } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, EmptyState, Skeleton, Text, useTheme, Wordmark } from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoManager } from '../../features/photo-manager/PhotoManager.jsx';
import { CampusIllustration } from '../../shared/ui/Illustration.jsx';
import {
  AgeRangeForm,
  BasicsForm,
  InterestedInForm,
} from '../../features/profile-fields/forms.jsx';

/** @type {Map<string, import('@vouch/i18n').MessageKey>} */
const TITLES = new Map([
  ['basics', 'onboarding.basics.title'],
  ['interestedIn', 'onboarding.interestedIn.title'],
  ['ageRange', 'onboarding.ageRange.title'],
  ['photos', 'onboarding.photos.title'],
]);

/** Onboarding, resumed after the app closes (shared logic in features-core). */
export function OnboardingScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const onboarding = useOnboarding();
  const { step, profile } = onboarding;
  if (onboarding.isLoading || !profile || !step) return <Skeleton height={32} />;
  if (step === 'done') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState
          art={<CampusIllustration width={300} />}
          title={t('onboarding.done.title')}
          body={profile.missing.length > 0 ? t('onboarding.done.body') : undefined}
          action={
            <Button title={t('onboarding.done.action')} onPress={() => router.replace('/(tabs)')} />
          }
        />
      </SafeAreaView>
    );
  }
  const index = ONBOARDING_STEPS.indexOf(step);
  const usable = profile.photos.filter((p) => p.status !== 'rejected').length;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: space[5] }} keyboardShouldPersistTaps="handled">
        <Wordmark height={30} />
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', gap: space[1], marginTop: space[4] }}
        >
          {ONBOARDING_STEPS.map((name, i) => (
            <View
              key={name}
              style={{
                flex: 1,
                height: 5,
                borderRadius: 3,
                backgroundColor: i <= index ? colors.primary : colors.secondary,
              }}
            />
          ))}
        </View>
        <Text variant="caption" muted style={{ marginTop: space[2] }}>
          {t('onboarding.progress', { step: index + 1, total: ONBOARDING_STEPS.length })}
        </Text>
        <Text variant="h1" style={{ marginTop: space[2], marginBottom: space[5] }}>
          {t(/** @type {import('@vouch/i18n').MessageKey} */ (TITLES.get(step)))}
        </Text>
        {step === 'basics' ? (
          <BasicsForm profile={profile} onSaved={() => void onboarding.complete('basics')} />
        ) : null}
        {step === 'interestedIn' ? (
          <InterestedInForm
            profile={profile}
            onSaved={() => void onboarding.complete('interestedIn')}
          />
        ) : null}
        {step === 'ageRange' ? (
          <AgeRangeForm profile={profile} onSaved={() => void onboarding.complete('ageRange')} />
        ) : null}
        {step === 'photos' ? (
          <>
            <PhotoManager profile={profile} />
            {usable < MIN_PHOTOS ? (
              <Text variant="caption" muted style={{ marginBottom: space[2] }}>
                {t('onboarding.photos.needMore')}
              </Text>
            ) : null}
            <Button
              title={t('common.continue')}
              disabled={usable < MIN_PHOTOS}
              onPress={() => void onboarding.complete('photos')}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
