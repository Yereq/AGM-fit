import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  serverTimestamp,
  getDocFromServer
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: "AIzaSyD-yI-91EOtBuOz6QM-1knedNVW437cXBQ",
  authDomain: "agm-fit.firebaseapp.com",
  projectId: "agm-fit",
  storageBucket: "agm-fit.firebasestorage.app",
  messagingSenderId: "668290589283",
  appId: "1:668290589283:web:1e43b9274b514df6ac8e56",
  firestoreDatabaseId: "ai-studio-arikgranitfitnes-3fd8962e-824b-4f3c-9632-9d79f3426f23"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });
export { onAuthStateChanged };

// Super Admin
export const SUPER_ADMIN_EMAIL = 'arik.pic@gmail.com';

/**
 * Normalizes email addressing, specifically handling Gmail dot-aliases and plus-tags
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const clean = email.trim().toLowerCase();
  const atIdx = clean.indexOf('@');
  if (atIdx === -1) return clean;
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const baseLocal = local.replace(/\./g, '').split('+')[0];
    return `${baseLocal}@gmail.com`;
  }
  return clean;
}

export function isSuperAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  const norm = normalizeEmail(clean);
  return norm === 'arikpic@gmail.com' || clean === 'arik.pic@gmail.com';
}

// Operation Types for error handling
export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
    },
    operationType,
    path
  };
  try {
    console.error('Firestore Error:', JSON.stringify(errInfo));
  } catch (_) {
    console.error('Firestore Error:', errInfo.error, operationType, path);
  }
  return errInfo;
}

// Test initial server connectivity
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'app_config', 'whitelist'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline. Local cache will be used.');
    }
  }
}
testConnection();

// Helper to sanitize email for document path
export function sanitizeEmailKey(email) {
  if (!email || typeof email !== 'string') return 'anonymous';
  return email.trim().toLowerCase();
}

/**
 * Access Control & Whitelist
 */
export async function fetchWhitelist() {
  const whitelistRef = doc(db, 'app_config', 'whitelist');
  const baseDefaults = [SUPER_ADMIN_EMAIL.toLowerCase(), normalizeEmail(SUPER_ADMIN_EMAIL), 'granit@gmail.com', 'maor@gmail.com'];
  try {
    const snap = await getDoc(whitelistRef);
    if (snap.exists()) {
      const data = snap.data();
      const list = Array.isArray(data.emails) ? data.emails : [];
      // Clean and ensure valid email entries
      const filtered = list.filter(e => typeof e === 'string' && e.trim().includes('@'));
      const combined = Array.from(new Set([...baseDefaults, ...filtered.map(e => String(e).trim().toLowerCase())]));
      return combined;
    } else {
      // If doc doesn't exist and current user is Super Admin, initialize it
      if (auth.currentUser && isSuperAdminEmail(auth.currentUser.email)) {
        await setDoc(whitelistRef, {
          emails: baseDefaults,
          updatedAt: new Date().toISOString(),
          updatedBy: auth.currentUser.email || SUPER_ADMIN_EMAIL
        });
      }
      return baseDefaults;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'app_config/whitelist');
    return baseDefaults;
  }
}

export async function isEmailAuthorized(email) {
  if (!email || typeof email !== 'string') return false;
  const cleanEmail = email.trim().toLowerCase();
  
  // 1. Super Admin is always authorized
  if (isSuperAdminEmail(cleanEmail)) {
    return true;
  }

  // 2. Check against custom profiles stored in Cloud
  try {
    const cloudProfiles = await fetchProfilesFromCloud();
    const normalized = normalizeEmail(cleanEmail);
    const matched = cloudProfiles.find(p => p.email && normalizeEmail(p.email) === normalized);
    if (matched) {
      return true;
    }
  } catch (err) {
    console.warn('Notice checking cloud profiles for authorization:', err);
  }

  // 3. Check against locally configured profiles
  try {
    const { state } = await import('./state.js');
    const profiles = state.getAllUserProfiles();
    const normalized = normalizeEmail(cleanEmail);
    const matchedProfile = profiles.find(p => p.email && normalizeEmail(p.email) === normalized);
    if (matchedProfile) {
      return true;
    }
  } catch (err) {
    // Ignore local check errors
  }

  // 4. Check against Firestore whitelist
  try {
    const allowedEmails = await fetchWhitelist();
    const normalized = normalizeEmail(cleanEmail);
    const isWhitelisted = allowedEmails.some(e => normalizeEmail(e) === normalized);
    return isWhitelisted;
  } catch (err) {
    console.warn('Notice verifying email authorization:', err);
    return false;
  }
}

export async function addEmailToWhitelist(newEmail) {
  if (!newEmail || typeof newEmail !== 'string') return false;
  const cleanEmail = newEmail.trim().toLowerCase();
  if (!cleanEmail.includes('@')) return false;
  const whitelistRef = doc(db, 'app_config', 'whitelist');

  try {
    const currentList = await fetchWhitelist();
    if (!currentList.includes(cleanEmail)) {
      currentList.push(cleanEmail);
      await setDoc(whitelistRef, {
        emails: currentList,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser?.email || SUPER_ADMIN_EMAIL
      }, { merge: true });
    }
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'app_config/whitelist');
    return false;
  }
}

export async function removeEmailFromWhitelist(emailToRemove) {
  if (!emailToRemove || typeof emailToRemove !== 'string') return false;
  const cleanEmail = emailToRemove.trim().toLowerCase();
  if (isSuperAdminEmail(cleanEmail)) {
    throw new Error('לא ניתן להסיר את מנהל המערכת (Super Admin).');
  }

  const whitelistRef = doc(db, 'app_config', 'whitelist');
  try {
    const currentList = await fetchWhitelist();
    const filteredList = currentList.filter(e => !isSuperAdminEmail(e) && normalizeEmail(e) !== normalizeEmail(cleanEmail));
    await setDoc(whitelistRef, {
      emails: filteredList,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.currentUser?.email || SUPER_ADMIN_EMAIL
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'app_config/whitelist');
    throw err;
  }
}

export async function syncProfilesToCloud(profiles) {
  try {
    const profRef = doc(db, 'app_config', 'custom_profiles');
    await setDoc(profRef, {
      profiles: Array.isArray(profiles) ? profiles : [],
      updatedAt: new Date().toISOString(),
      updatedBy: auth.currentUser?.email || SUPER_ADMIN_EMAIL
    }, { merge: true });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'app_config/custom_profiles');
    return false;
  }
}

export async function fetchProfilesFromCloud() {
  try {
    const profRef = doc(db, 'app_config', 'custom_profiles');
    const snap = await getDoc(profRef);
    if (snap.exists()) {
      const data = snap.data();
      return Array.isArray(data.profiles) ? data.profiles : [];
    }
  } catch (err) {
    console.warn('Notice fetching cloud custom profiles:', err);
  }
  return [];
}

/**
 * Authentication Flow with Google
 */
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    const userEmail = user?.email || user?.providerData?.[0]?.email || '';

    // Verify email authorization immediately
    const authorized = await isEmailAuthorized(userEmail);
    if (!authorized) {
      try {
        await user.delete();
      } catch (delErr) {
        console.warn('Notice deleting unauthorized user:', delErr);
        await signOut(auth);
      }
      const error = new Error('UNAUTHORIZED_USER');
      error.customMessage = `חשבון זה (${userEmail}) אינו מורשה במערכת. יש לפנות לאריק (Super Admin) להוספה לרשימת המורשים.`;
      error.isUnauthorized = true;
      throw error;
    }

    return user;
  } catch (err) {
    if (err.message === 'UNAUTHORIZED_USER' || err.isUnauthorized) {
      console.warn('Google Sign-In: Unauthorized user blocked:', err.customMessage);
    } else if (err.code === 'auth/unauthorized-domain') {
      err.customMessage = 'הדומיין הנוכחי אינו מורשה ב-Firebase Console.';
      err.domain = window.location.hostname;
      err.isUnauthorizedDomain = true;
      console.warn('Firebase Auth: domain is not yet added to Authorized Domains in Firebase Console:', window.location.hostname);
    } else if (err.code === 'auth/popup-closed-by-user') {
      console.warn('Google Sign-In popup closed by user.');
    } else {
      console.error('Google Sign-In failed:', err);
    }
    throw err;
  }
}

export async function logOut() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Sign out error:', err);
  }
}

/**
 * Shared Food Catalog ('custom_meals' Collection)
 */
export function listenToCustomMeals(onData, onError) {
  const customMealsCol = collection(db, 'custom_meals');
  return onSnapshot(
    customMealsCol,
    (snapshot) => {
      const meals = [];
      snapshot.forEach((docSnap) => {
        meals.push({ id: docSnap.id, ...docSnap.data() });
      });
      // Sort alphabetically or by creation date
      meals.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      onData(meals);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'custom_meals');
      if (onError) onError(err);
    }
  );
}

export async function addCustomMealToCloud(mealData) {
  const mealId = mealData.id || ('meal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
  const docRef = doc(db, 'custom_meals', mealId);

  const payload = {
    id: mealId,
    name: String(mealData.name || '').trim(),
    recipe: String(mealData.recipe || '').trim(),
    kcal: Number(mealData.kcal) || 0,
    protein: Number(mealData.protein) || 0,
    carbs: Number(mealData.carbs) || 0,
    fat: Number(mealData.fat) || 0,
    createdByUser: auth.currentUser?.email || 'unknown',
    createdByDisplayName: auth.currentUser?.displayName || 'משתמש AGM Fit',
    createdAt: mealData.createdAt || new Date().toISOString()
  };

  try {
    await setDoc(docRef, payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `custom_meals/${mealId}`);
    throw err;
  }
}

export async function deleteCustomMealFromCloud(mealId) {
  if (!mealId) return;
  const docRef = doc(db, 'custom_meals', mealId);
  try {
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `custom_meals/${mealId}`);
    throw err;
  }
}

/**
 * Private Per-User Records: Daily Logs
 * Path: users/{userEmail}/daily_logs/{YYYY-MM-DD}
 */
export async function syncDailyLogToCloud(userEmail, dateStr, dailyData) {
  if (!userEmail || !dateStr) return;
  const safeEmail = sanitizeEmailKey(userEmail);
  const logRef = doc(db, 'users', safeEmail, 'daily_logs', dateStr);

  const payload = {
    date: dateStr,
    userEmail: safeEmail,
    updatedAt: new Date().toISOString()
  };

  if (Array.isArray(dailyData.meals)) {
    payload.meals = dailyData.meals;
  }
  if (dailyData.workout !== undefined) {
    payload.workout = dailyData.workout;
  }
  if (dailyData.totalMacros !== undefined) {
    payload.totalMacros = dailyData.totalMacros;
  }

  try {
    await setDoc(logRef, payload, { merge: true });
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${safeEmail}/daily_logs/${dateStr}`);
    throw err;
  }
}

export async function fetchDailyLogFromCloud(userEmail, dateStr) {
  if (!userEmail || !dateStr) return null;
  const safeEmail = sanitizeEmailKey(userEmail);
  const logRef = doc(db, 'users', safeEmail, 'daily_logs', dateStr);

  try {
    const snap = await getDoc(logRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${safeEmail}/daily_logs/${dateStr}`);
    return null;
  }
}

export async function fetchAllDailyLogsFromCloud(userEmail) {
  if (!userEmail) return [];
  const safeEmail = sanitizeEmailKey(userEmail);
  const colRef = collection(db, 'users', safeEmail, 'daily_logs');

  try {
    const snap = await getDocs(colRef);
    const logs = [];
    snap.forEach(docSnap => {
      logs.push(docSnap.data());
    });
    return logs;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `users/${safeEmail}/daily_logs`);
    return [];
  }
}

export function listenToDailyLog(userEmail, dateStr, onData, onError) {
  if (!userEmail || !dateStr) return () => {};
  const safeEmail = sanitizeEmailKey(userEmail);
  const logRef = doc(db, 'users', safeEmail, 'daily_logs', dateStr);

  return onSnapshot(
    logRef,
    (snap) => {
      if (snap.exists()) {
        onData(snap.data());
      } else {
        onData(null);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${safeEmail}/daily_logs/${dateStr}`);
      if (onError) onError(err);
    }
  );
}

/**
 * Private Per-User Records: Tanita Logs
 * Path: users/{userEmail}/tanita_logs/{logId}
 */
export async function syncTanitaEntryToCloud(userEmail, entry) {
  if (!userEmail || !entry) return;
  const safeEmail = sanitizeEmailKey(userEmail);
  const logId = entry.id || (`tanita_${entry.date || Date.now()}`);
  const logRef = doc(db, 'users', safeEmail, 'tanita_logs', logId);

  const payload = {
    id: logId,
    date: entry.date || new Date().toISOString().split('T')[0],
    weight: Number(entry.weight) || 0,
    bmi: entry.bmi !== undefined ? Number(entry.bmi) : null,
    bodyFat: entry.bodyFat !== undefined ? Number(entry.bodyFat) : null,
    muscleKg: entry.muscleKg !== undefined ? Number(entry.muscleKg) : null,
    boneMass: entry.boneMass !== undefined ? Number(entry.boneMass) : null,
    bmr: entry.bmr !== undefined ? Number(entry.bmr) : null,
    waterPct: entry.waterPct !== undefined ? Number(entry.waterPct) : null,
    metabolicAge: entry.metabolicAge !== undefined ? Number(entry.metabolicAge) : null,
    visceralFat: entry.visceralFat !== undefined ? Number(entry.visceralFat) : null,
    muscleQuality: entry.muscleQuality !== undefined ? Number(entry.muscleQuality) : null,
    bodyType: entry.bodyType !== undefined ? Number(entry.bodyType) : null,
    source: entry.source || 'manual',
    rawText: entry.rawText || '',
    updatedAt: new Date().toISOString()
  };

  try {
    await setDoc(logRef, payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${safeEmail}/tanita_logs/${logId}`);
    throw err;
  }
}

export async function fetchTanitaLogsFromCloud(userEmail) {
  if (!userEmail) return [];
  const safeEmail = sanitizeEmailKey(userEmail);
  const colRef = collection(db, 'users', safeEmail, 'tanita_logs');

  try {
    const snap = await getDocs(colRef);
    const logs = [];
    snap.forEach(docSnap => {
      logs.push(docSnap.data());
    });
    logs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return logs;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `users/${safeEmail}/tanita_logs`);
    return [];
  }
}

export function listenToTanitaLogs(userEmail, onData, onError) {
  if (!userEmail) return () => {};
  const safeEmail = sanitizeEmailKey(userEmail);
  const colRef = collection(db, 'users', safeEmail, 'tanita_logs');

  return onSnapshot(
    colRef,
    (snap) => {
      const logs = [];
      snap.forEach(docSnap => {
        logs.push(docSnap.data());
      });
      logs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      onData(logs);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${safeEmail}/tanita_logs`);
      if (onError) onError(err);
    }
  );
}

export async function deleteTanitaEntryFromCloud(userEmail, logId) {
  if (!userEmail || !logId) return;
  const safeEmail = sanitizeEmailKey(userEmail);
  const docRef = doc(db, 'users', safeEmail, 'tanita_logs', logId);
  try {
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${safeEmail}/tanita_logs/${logId}`);
    throw err;
  }
}

/**
 * Private Per-User Records: Targets Settings
 * Path: users/{userEmail}/settings/targets
 */
export async function syncTargetsToCloud(userEmail, targets) {
  if (!userEmail || !targets) return;
  const safeEmail = sanitizeEmailKey(userEmail);
  const docRef = doc(db, 'users', safeEmail, 'settings', 'targets');

  const payload = {
    ...targets,
    userEmail: safeEmail,
    updatedAt: new Date().toISOString()
  };

  try {
    await setDoc(docRef, payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${safeEmail}/settings/targets`);
    throw err;
  }
}

export async function fetchTargetsFromCloud(userEmail) {
  if (!userEmail) return null;
  const safeEmail = sanitizeEmailKey(userEmail);
  const docRef = doc(db, 'users', safeEmail, 'settings', 'targets');

  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${safeEmail}/settings/targets`);
    return null;
  }
}
