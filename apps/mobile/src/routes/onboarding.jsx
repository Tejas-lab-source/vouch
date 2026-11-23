// @ts-check
import { useSession } from '@vouch/features-core';
import { Redirect } from 'expo-router';
import { OnboardingScreen } from '../pages/onboarding/OnboardingScreen.jsx';

export default function Onboarding() {
  const { signedIn } = useSession();
  return signedIn ? <OnboardingScreen /> : <Redirect href="/sign-in" />;
}
