# YBK Mobile: Local Build Setup

This guide prioritizes local builds so you do not wait in EAS cloud queues.

## Local APK fast path (no EAS)

Run these commands in YBK-APP:

1. npm install
2. npm run android:apk:local:all
3. Install the generated file `YBK-APP-local-release.apk` on your phone.

Optional direct install when your phone is connected by USB:

1. npm run android:apk:local
2. npm run android:install:local

Updates in this mode are link-based from Settings (no OTA publish required):

- Set `EXPO_PUBLIC_ANDROID_APK_UPDATE_URL` to your latest APK download URL.
- Send update notification from admin alerts.
- User taps Check for Updates, then Install Update.

## iOS local fast path (no EAS queue)

Requirements:

- Xcode installed
- CocoaPods installed (`brew install cocoapods`)

Run these commands in YBK-APP:

1. npm install
2. npm run ios:local:setup
3. npm run ios:sim:local

This compiles the app locally for simulator using Xcode toolchain.

For physical iPhone / TestFlight-ready archive (local machine build):

1. npm run ios:archive:local
2. npm run ios:open:xcode
3. In Xcode Organizer, distribute/upload the archive.

Notes:

- This avoids EAS build queues.
- Apple processing time after upload still applies.

## 1) Required env values

In YBK-APP/.env, set:

- EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
- EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
- EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID

Expo Go-only values are optional and should only be used for fallback testing:

- EXPO_PUBLIC_GOOGLE_EXPO_IOS_CLIENT_ID
- EXPO_PUBLIC_GOOGLE_EXPO_ANDROID_CLIENT_ID

Optional update links for Settings -> Check for Updates:

- EXPO_PUBLIC_ANDROID_PLAY_STORE_URL
- EXPO_PUBLIC_ANDROID_APK_UPDATE_URL
- EXPO_PUBLIC_IOS_APP_STORE_URL
- EXPO_PUBLIC_APP_UPDATE_URL

## 2) Google OAuth checks

Your native OAuth clients must match app identifiers from app.json:

- iOS bundle identifier: com.ybk.arnold
- Android package: com.ybk.arnold

Android also requires SHA-1 for the signing key used by your build.

## 3) Build and run (recommended local path)

From YBK-APP:

1. Install dependencies:
   npm install

2. Build native app locally:
   - iOS simulator: npm run ios:sim:local
   - Android release APK: npm run android:apk:local:all

3. Start Metro for dev client:
   npm run start:dev-client

4. Open the installed dev build on device/simulator and connect to Metro.

## 4) Optional EAS internal dev build

Use only if you explicitly want cloud build infrastructure.

If you want installable dev clients on physical devices:

- npx eas login
- npx eas build --profile development --platform ios
- npx eas build --profile development --platform android

Then start Metro with:

- npm run start:dev-client

## 5) If login still fails

- Confirm each OAuth client belongs to the same Firebase/Google project.
- Confirm iOS client is type "iOS" and Android client is type "Android".
- Confirm Android SHA-1 matches the actual signing key of the installed build.
- Fully restart Metro: npm run start:dev-client

## 6) Release files for stores

Preferred local-first path for iOS:

1. npm run ios:archive:local
2. Open Xcode Organizer and upload archive.

Optional EAS cloud path (slower queue during busy periods):

From YBK-APP:

1. Sign in to EAS:
   npm run eas:login

2. Build Android App Bundle for Google Play upload (.aab):
   npm run eas:android:play

3. Build Android package file for direct install/testing (.apk):
   npm run eas:android:apk
   (Alias also available: npm run eas:android:pk)

4. Build iOS App Store archive (.ipa):
   npm run eas:ios:store

5. Check recent builds:
   npm run eas:build:list

## 7) Optional direct submit to stores

After a successful store build, you can submit the latest artifact:

- Android (Google Play):
  npm run eas:submit:android

- iOS (App Store Connect):
  npm run eas:submit:ios

## 8) One install, then OTA updates

If you want users to install once and receive future app-code updates:

1. Build and distribute a new APK/AAB generated after OTA config is enabled.
2. Keep that app installed on user devices.
3. For future JavaScript/UI logic changes (no native module changes), publish updates with:
   npm run eas:update:production

The app checks OTA updates on launch and the Settings update button can trigger update checks.

Important:

- Native changes (new native libraries, AndroidManifest/Info.plist/native config changes) still require a new binary build and install.
- Regular React/TypeScript screen/logic changes can ship via OTA without reinstalling.
