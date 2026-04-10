import AsyncStorage from '@react-native-async-storage/async-storage'
import { getApp, getApps, initializeApp } from 'firebase/app'
import * as FirebaseAuth from '@firebase/auth'
import { getAuth, initializeAuth, type Persistence } from '@firebase/auth'

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyDmjGMwvsQK2VNuoJZ-Iu8H_vdV91w3hJs',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'ybkarnold-b7ec0.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'ybkarnold-b7ec0',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'ybkarnold-b7ec0.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '304964900278',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '1:304964900278:web:9880708d65509f53b57e07',
}

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)

const getReactNativePersistence = (
  FirebaseAuth as unknown as {
    getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence
  }
).getReactNativePersistence

const auth = (() => {
  try {
    if (!getReactNativePersistence) {
      return getAuth(firebaseApp)
    }

    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    })
  } catch {
    return getAuth(firebaseApp)
  }
})()

export const mobileAuth = auth
