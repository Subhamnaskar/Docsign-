import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

type NotificationsModule = typeof import('expo-notifications');
type NotificationResponse = import('expo-notifications').NotificationResponse;

/**
 * expo-notifications, only where it exists: real builds. Expo Go on Android has
 * no push module since SDK 53 and crashes when it is merely imported, and
 * browser previews have no push; there the app runs without alerts.
 */
let loaded: NotificationsModule | null | undefined;
function notifications(): NotificationsModule | null {
  if (loaded === undefined) {
    const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    loaded = Platform.OS === 'web' || inExpoGo ? null : (require('expo-notifications') as NotificationsModule);
    // Show alerts while the app is open too
    loaded?.setNotificationHandler({
      handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
    });
  }
  return loaded;
}

let pushToken: string | null = null;
export const currentPushToken = () => pushToken;

/**
 * Asks for permission and registers this phone with the server. Needs a real
 * build on a real device and an EAS project id (set by `eas init`); otherwise it does nothing.
 */
export async function registerForPush(): Promise<void> {
  const Notifications = notifications();
  if (!Notifications || !Device.isDevice) return;
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

/** Calls `open` with the screen a tapped alert points to (including the alert that launched the app). Returns a stop function. */
export function onNotificationTap(open: (route: string) => void): () => void {
  const Notifications = notifications();
  if (!Notifications) return () => {};
  const handle = (response: NotificationResponse | null) => {
    const to = routeForNotification(response?.notification.request.content.data);
    if (to) open(to);
  };
  Notifications.getLastNotificationResponseAsync().then(handle);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

/** Where a tapped alert should open: the server sends { screen: 'agreement', id } or { screen: 'to-sign' }. */
export function routeForNotification(data: Record<string, unknown> | undefined): string | null {
  if (data?.screen === 'agreement' && typeof data.id === 'string') return `/agreement/${data.id}`;
  if (data?.screen === 'to-sign') return '/to-sign';
  return null;
}
