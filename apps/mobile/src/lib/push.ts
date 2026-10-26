import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

// Show alerts while the app is open too
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

let pushToken: string | null = null;
export const currentPushToken = () => pushToken;

/**
 * Asks for permission and registers this phone with the server. Needs a real
 * device and an EAS project id (set by `eas init`); otherwise it does nothing.
 */
export async function registerForPush(): Promise<void> {
  if (!Device.isDevice) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Agreements', importance: Notifications.AndroidImportance.HIGH });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api('/mobile/push-devices', { json: { token: pushToken, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
}

/** Where a tapped alert should open: the server sends { screen: 'agreement', id } or { screen: 'to-sign' }. */
export function routeForNotification(data: Record<string, unknown> | undefined): string | null {
  if (data?.screen === 'agreement' && typeof data.id === 'string') return `/agreement/${data.id}`;
  if (data?.screen === 'to-sign') return '/to-sign';
  return null;
}
