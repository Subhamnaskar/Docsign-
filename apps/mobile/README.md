# Nuronix eSign mobile app

Android and iPhone app (Expo SDK 58, React Native, Expo Router). It talks to
the same server as the website.

| In the app | How |
|---|---|
| Sign in, two-factor, Face ID / fingerprint lock | Native (`/mobile/login`, token in the phone's secure storage) |
| Home, agreements list, search, details, reminders | Native |
| Agreements waiting for my signature | Native list (`/mobile/to-sign`); signing opens the signing page |
| Send: choose a PDF or scan paper pages, add signers | Native; fields are placed on the website editor inside the app |
| Sign a document yourself | Native upload; signature placed on `/sign-yourself?id=…` inside the app |
| Share the signed PDF and certificate | Native share sheet (save to Files, WhatsApp, email…) |
| Alerts: "please sign", signed, declined, completed | Push notifications through Expo |

Website pages open signed in through a one-time link (`/mobile/web-session`),
so nothing is typed twice.

## Try it on your phone (no build needed)

1. Install **Expo Go** from the Play Store or App Store.
2. On the PC, in this folder: `npm install` (first time), then `npx expo start`.
3. Scan the QR code: Android with Expo Go, iPhone with the Camera app.
   The phone and PC must be on the same Wi-Fi.

Everything works in Expo Go except push alerts on Android, which need a real build (below).

The server address is `extra.apiUrl` in `app.json`. Change it to
`https://sign.nuronixai.in` once that domain is live. For a local server, start with
`EXPO_PUBLIC_API_URL=http://<PC's IP>:3000 npx expo start`.

## Push alerts and real builds (EAS, in the cloud)

No Android Studio or Mac is needed; Expo builds in the cloud (free plan has a monthly quota).

```bash
npx eas-cli@latest login          # free Expo account
npx eas-cli@latest init           # links the app; adds the project id push needs
npx eas-cli@latest build -p android --profile preview   # an .apk to install on Android phones
```

- **Android alerts:** create a Firebase project, then upload its FCM key with
  `npx eas-cli@latest credentials` (Android → Push Notifications).
- **iPhone:** needs an Apple Developer account ($99/year); EAS creates the certificates.

## Publishing

```bash
npx eas-cli@latest build -p all --profile production
npx eas-cli@latest submit -p android   # Google Play ($25 once)
npx eas-cli@latest submit -p ios       # App Store
```

App ids: `in.nuronixai.esign` (both stores).

## Checks

```bash
npx tsc --noEmit
npx expo-doctor
```
