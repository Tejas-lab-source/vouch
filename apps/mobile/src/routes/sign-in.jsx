// @ts-check
import { useSession } from '@vouch/features-core';
import { Redirect } from 'expo-router';
import { SignInScreen } from '../pages/sign-in/SignInScreen.jsx';

export default function SignInRoute() {
  const { signedIn } = useSession();
  return signedIn ? <Redirect href="/(tabs)" /> : <SignInScreen />;
}
