// @ts-check
import { t } from '@vouch/i18n';
import { Button, EmptyState, useTheme } from '@vouch/ui-native';
import * as Linking from 'expo-linking';
import { Platform, View } from 'react-native';

const STORE_URL = Platform.select({
  ios: 'https://apps.apple.com/app/vouch',
  default: 'https://play.google.com/store/apps/details?id=app.vouch.mobile',
});

/** Blocks the app when this build is older than the minimum the API supports. */
export function UpdateRequired() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
      <EmptyState
        title={t('update.title')}
        body={t('update.body')}
        action={
          <Button title={t('update.action')} onPress={() => void Linking.openURL(STORE_URL)} />
        }
      />
    </View>
  );
}
