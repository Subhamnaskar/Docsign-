import * as SecureStore from 'expo-secure-store';

/** Small secrets (session token, settings) in the phone's keychain / keystore. */
export const secure = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
