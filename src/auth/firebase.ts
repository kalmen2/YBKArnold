import { initializeApp, getApp, getApps } from 'firebase/app'
import { GoogleAuthProvider, getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
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
export const firebaseStorage = getStorage(firebaseApp)
export const googleAuthProvider = new GoogleAuthProvider()
export const isFirebaseAuthConfigured = hasFirebaseAuthConfig

googleAuthProvider.setCustomParameters({
  prompt: 'select_account',
})
