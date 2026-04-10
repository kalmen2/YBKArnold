import { initializeApp, getApp, getApps } from 'firebase/app'
import { GoogleAuthProvider, getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ??
    'AIzaSyDmjGMwvsQK2VNuoJZ-Iu8H_vdV91w3hJs',
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ??
    'ybkarnold-b7ec0.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'ybkarnold-b7ec0',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ??
    'ybkarnold-b7ec0.firebasestorage.app',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '304964900278',
}

const hasFirebaseAuthConfig =
  typeof firebaseConfig.apiKey === 'string' &&
  firebaseConfig.apiKey.trim().length > 0 &&
  typeof firebaseConfig.authDomain === 'string' &&
  firebaseConfig.authDomain.trim().length > 0 &&
  typeof firebaseConfig.projectId === 'string' &&
  firebaseConfig.projectId.trim().length > 0

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
export const firebaseAuth = getAuth(firebaseApp)
export const googleAuthProvider = new GoogleAuthProvider()
export const isFirebaseAuthConfigured = hasFirebaseAuthConfig

googleAuthProvider.setCustomParameters({
  prompt: 'select_account',
})
