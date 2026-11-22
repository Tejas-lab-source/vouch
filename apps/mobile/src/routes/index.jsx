// @ts-check
import { useSession } from '@vouch/features-core';
import { Redirect } from 'expo-router';

export default function Index() {
  const { signedIn } = useSession();
  return <Redirect href={signedIn ? '/(tabs)' : '/sign-in'} />;
}
