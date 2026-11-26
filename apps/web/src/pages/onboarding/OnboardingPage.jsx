// @ts-check
import { MIN_PHOTOS, ONBOARDING_STEPS, useOnboarding } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, EmptyState, Illustration, Skeleton, Wordmark } from '@vouch/ui-web';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { PhotoManager } from '../../features/photo-manager/PhotoManager.jsx';
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

/**
 * Onboarding after sign-up: about you → who to meet → ages → photos → done. The step comes
 * from the server profile plus the device's record of confirmed steps, so closing the tab
 * resumes where the user left off.
 */
export function OnboardingPage() {
  const onboarding = useOnboarding();
  const navigate = useNavigate();
  const heading = useRef(/** @type {HTMLHeadingElement | null} */ (null));
  const { step, profile } = onboarding;

  // Move focus to the new step's heading, so screen readers announce it.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  if (onboarding.isLoading || !profile || !step) {
    return (
      <main className="w-page w-page--narrow" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton height={32} />
      </main>
    );
  }
  if (step === 'done') {
    return (
      <main className="w-page w-page--narrow">
        <EmptyState
          art={<Illustration name="campus" className="w-empty-art" />}
          title={t('onboarding.done.title')}
          body={profile.missing.length > 0 ? t('onboarding.done.body') : undefined}
          action={
            <Button onClick={() => navigate('/', { replace: true })}>
              {t('onboarding.done.action')}
            </Button>
          }
        />
      </main>
    );
  }
  const index = ONBOARDING_STEPS.indexOf(step);
  const usable = profile.photos.filter((p) => p.status !== 'rejected').length;
  return (
    <main className="w-page w-page--narrow">
      <div className="w-brand">
        <Wordmark height={32} />
      </div>
      <p className="v-field__hint">
        {t('onboarding.progress', { step: index + 1, total: ONBOARDING_STEPS.length })}
      </p>
      <progress
        className="w-progress"
        max={ONBOARDING_STEPS.length}
        value={index + 1}
        aria-hidden="true"
      />
      <h1 className="w-title" tabIndex={-1} ref={heading}>
        {t(/** @type {import('@vouch/i18n').MessageKey} */ (TITLES.get(step)))}
      </h1>
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
            <p className="v-field__hint">{t('onboarding.photos.needMore')}</p>
          ) : null}
          <Button
            block
            disabled={usable < MIN_PHOTOS}
            onClick={() => void onboarding.complete('photos')}
          >
            {t('common.continue')}
          </Button>
        </>
      ) : null}
    </main>
  );
}
