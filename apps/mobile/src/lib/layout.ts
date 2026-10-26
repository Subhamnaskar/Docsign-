import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Platform, useWindowDimensions } from 'react-native';

/** Content never gets wider than this, so tablets read like a centred page. */
export const MAX_CONTENT_WIDTH = 760;
/** Forms (sign in, lock) are narrower still. */
export const MAX_FORM_WIDTH = 460;
/** From this width lists use two columns (tablets, large foldables). */
const WIDE = 700;

export function useLayout() {
  const { width } = useWindowDimensions();
  return { width, wide: width >= WIDE };
}

/**
 * Phones stay upright; tablets turn with the device (the app declares every
 * orientation, which iPad multitasking and the App Store require).
 */
export function lockPhonesUpright() {
  if (Platform.OS === 'web' || Device.deviceType !== Device.DeviceType.PHONE) return;
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
}
