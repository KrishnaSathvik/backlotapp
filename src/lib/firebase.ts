import { initializeApp, getApps } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { firebasePublicConfig } from './firebase-public-config.ts';

const app = getApps().length ? getApps()[0] : initializeApp(firebasePublicConfig());

export const auth = getAuth(app);

// Local end-to-end testing only: sign in against the Firebase Auth emulator with fake
// accounts. Ignored in production builds, so it can't be switched on in a deployment.
const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost && process.env.NODE_ENV !== 'production' && !(auth as { emulatorConfig?: unknown }).emulatorConfig) {
  connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
}
export const googleAuthProvider = new GoogleAuthProvider();
