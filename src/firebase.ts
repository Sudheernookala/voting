import { initializeApp } from 'firebase/app';
import * as authLib from 'firebase/auth';
import { getAuth, signInAnonymously, connectAuthEmulator, type User } from 'firebase/auth';
import * as dbLib from 'firebase/database';
import { getDatabase, ref, connectDatabaseEmulator } from 'firebase/database';
import { firebaseConfig } from './firebaseConfig';

// For automated tests: `VITE_EMULATOR_HOST=127.0.0.1 npm run dev` talks to the local Firebase emulator instead.
const emulatorHost = import.meta.env.VITE_EMULATOR_HOST as string | undefined;
const config = emulatorHost
  ? { apiKey: 'demo-key', projectId: 'demo-livevote', databaseURL: `http://${emulatorHost}:9000?ns=demo-livevote` }
  : firebaseConfig;

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getDatabase(app);
if (emulatorHost) {
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(db, emulatorHost, 9000);
  // Test-only hook (emulator mode only): lets automated tests sign in as Google users and try attacks.
  Object.assign(window, { __livevote: { auth, db, authLib, dbLib } });
}

export const r = (path: string) => ref(db, path);

/** Keep an existing sign-in (e.g. a host signed in with Google); otherwise sign in anonymously. */
export async function ensureUser(): Promise<User> {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser!;
}
