// Chart.js and Lucide Icons loaded via stable CDN scripts in index.html for native browser & bundler compatibility
const Chart = typeof window !== 'undefined' && window.Chart ? window.Chart : null;

// Universal helper to safely render and refresh Lucide icons across any view or async action
export function refreshIcons() {
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    try {
      window.lucide.createIcons();
    } catch (e) {
      console.warn('Lucide createIcons notice:', e);
    }
  }
}

import { state, AVAILABLE_THEMES, isThemeLight } from './state.js';
import { PROFILES, QUICK_PRESETS, calculateAutoMacros, isValidImageUrl, getUserProfile, APP_VERSION, APP_HOSTING_URL } from './config.js';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  logOut,
  fetchWhitelist,
  addEmailToWhitelist,
  removeEmailFromWhitelist,
  listenToCustomMeals,
  addCustomMealToCloud,
  deleteCustomMealFromCloud,
  fetchDailyLogFromCloud,
  fetchAllDailyLogsFromCloud,
  syncDailyLogToCloud,
  fetchTanitaLogsFromCloud,
  syncTanitaEntryToCloud,
  deleteTanitaEntryFromCloud,
  fetchTargetsFromCloud,
  fetchProfilesFromCloud,
  syncProfilesToCloud,
  SUPER_ADMIN_EMAIL,
  isEmailAuthorized
} from './firebase.js';
import {
  getMealsForDate,
  setMealsForDate,
  saveMeal,
  deleteMeal,
  calculateDailyMacros,
  hasMealsForDate,
  HERBALIFE_INGREDIENTS,
  SHAKE_LIQUIDS,
  calculateShakeNutrition,
  GRANIT_SHAKE_PRESETS,
  logGranitShakePreset,
  generateDayEmailReport,
  SINGLE_ITEM_BUILDING_BLOCKS,
  logSingleItemBuildingBlock,
  HERBALIFE_PRODUCTS,
  logHerbalifeProduct
} from './meals.js';
import {
  getTanitaHistory,
  getLatestTanitaEntry,
  saveTanitaEntry,
  deleteTanitaEntry,
  clearAllTanitaHistory,
  calculateTanitaTrends,
  parseTanitaText,
  BODY_TYPE_LABELS,
  TANITA_METRIC_CONFIGS,
  TANITA_METRIC_INFO
} from './tanita.js';
import { fetchAiCoachingFeedback } from './coach.js';
import { exportAllData, importAllData } from './storage.js';
import {
  getWorkoutForDate,
  saveWorkoutForDate,
  hasWorkoutForDate,
  calculateWorkoutBurn,
  calculateNetCalories,
  estimateStepsDistanceKm,
  estimateStepsCalories,
  MUSCLE_GROUPS
} from './workout.js';

class App {
  constructor() {
    this.granitShake = {
      f1: 2,
      pdm: 1,
      rebuild: 0,
      liquidId: 'water'
    };
    this.singleItemCounts = {
      olive_oil_tsp: 1,
      bread_slice_40g: 1,
      pita_angel_118g: 1,
      peanuts_30g: 1,
      cream_cheese_tbsp: 1,
      egg_large: 1,
      cottage_5_tbsp: 1,
      cottage_5_tub: 1,
      cottage_9_tbsp: 1,
      cottage_9_tub: 1
    };
    this.smartPasteDraft = null;
    this.toastTimer = null;
    this.charts = {};
    this.chartTimeframe = 'all';
    this.chartViewMode = 'all_11';
    this.selectedSingleMetric = 'weight';
    this.combinedScaleMode = 'original';
    this.combinedHiddenMetrics = [];

    const initialDate = new Date(state.selectedDate || Date.now());
    this.calendarYear = initialDate.getFullYear();
    this.calendarMonth = initialDate.getMonth();

    this.initListeners();
    this.initModalListeners();
    this.initCalendarListeners();
    this.initThemeListeners();
    this.initFirebaseAuth();
    this.updateHeaderHeight();
    window.addEventListener('resize', () => this.updateHeaderHeight());

    this.render();
    let lastSyncedDate = state.selectedDate;
    let lastActiveUser = state.activeUser;
    state.subscribe(() => {
      this.render();
      if ((state.selectedDate && state.selectedDate !== lastSyncedDate) || (state.activeUser && state.activeUser !== lastActiveUser)) {
        lastSyncedDate = state.selectedDate;
        lastActiveUser = state.activeUser;
        this.syncCloudDataForUser(lastSyncedDate).then(() => {
          this.render();
        }).catch(() => {});
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.authUser) {
        this.syncCloudDataForUser().then(() => this.render()).catch(() => {});
      }
    });
  }

  applyUserSessionToUI(user) {
    const overlay = document.getElementById('auth-login-overlay');
    const headerAuth = document.getElementById('header-auth-user');
    const userAvatarEl = document.getElementById('header-user-avatar');
    const userInitialsEl = document.getElementById('header-user-initials');

    if (overlay) overlay.classList.add('hidden');
    if (headerAuth) {
      headerAuth.classList.remove('hidden');
      headerAuth.classList.add('flex');
    }

    if (userAvatarEl && userInitialsEl) {
      if (user && user.photoURL) {
        userAvatarEl.src = user.photoURL;
        userAvatarEl.classList.remove('hidden');
        userInitialsEl.classList.add('hidden');
      } else {
        const initials = (user?.displayName || user?.email || 'AG')
          .split(' ')
          .map(n => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);
        userInitialsEl.textContent = initials || 'AG';
        userInitialsEl.classList.remove('hidden');
        userAvatarEl.classList.add('hidden');
      }
    }

    this.updateDrawerUserInfo();
  }

  initFirebaseAuth() {
    // If a session was previously restored from localStorage, apply it immediately
    if (state.authUser) {
      this.applyUserSessionToUI(state.authUser);
      if (!this.customMealsUnsub) {
        this.customMealsUnsub = listenToCustomMeals((meals) => {
          state.setCustomMeals(meals);
          if (state.activeTab === 'meals') {
            this.render();
          }
        });
      }
      fetchWhitelist().then(wList => state.setWhitelist(wList)).catch(() => {});
      this.syncCloudDataForUser();
    }

    // Auth state changed listener
    onAuthStateChanged(auth, async (user) => {
      const overlay = document.getElementById('auth-login-overlay');
      const headerAuth = document.getElementById('header-auth-user');

      if (!user) {
        state.setAuthUser(null);
        if (overlay) overlay.classList.remove('hidden');
        if (headerAuth) {
          headerAuth.classList.add('hidden');
          headerAuth.classList.remove('flex');
        }
        return;
      }

      // Authorize and initialize user session
      try {
        const userEmail = user.email || user.providerData?.[0]?.email || '';

        // Pre-fetch custom profiles and whitelist from Firestore so newly registered Google users are recognized
        try {
          const [cProfiles, wList] = await Promise.all([
            fetchProfilesFromCloud(),
            fetchWhitelist()
          ]);
          if (Array.isArray(cProfiles)) {
            state.mergeCloudCustomProfiles(cProfiles);
          }
          if (Array.isArray(wList)) {
            state.setWhitelist(wList);
          }
        } catch (err) {
          console.warn('Notice pre-fetching cloud auth data:', err);
        }

        const authorized = await isEmailAuthorized(userEmail);
        if (!authorized) {
          try {
            await user.delete();
          } catch (delErr) {
            await logOut();
          }
          state.setAuthUser(null);
          if (overlay) overlay.classList.remove('hidden');
          if (headerAuth) {
            headerAuth.classList.add('hidden');
            headerAuth.classList.remove('flex');
          }
          const alertEl = document.getElementById('auth-overlay-alert');
          if (alertEl) {
            alertEl.classList.remove('hidden');
            alertEl.className = 'p-3 rounded-xl text-xs font-bold transition-all text-center bg-red-500/20 text-red-300 border border-red-500/30';
            alertEl.textContent = `חשבון זה (${userEmail}) אינו מורשה במערכת. יש לפנות לאריק (Super Admin) לקבלת הרשאה.`;
          }
          this.showToast(`אין לך הרשאה לגשת למערכת (${userEmail}). פנה לאריק.`, 'error');
          return;
        }

        // Apply authorized user
        state.setAuthUser(user);
        this.applyUserSessionToUI(user);

        // Real-time listener for shared custom meals
        if (!this.customMealsUnsub) {
          this.customMealsUnsub = listenToCustomMeals((meals) => {
            state.setCustomMeals(meals);
            if (state.activeTab === 'meals') {
              this.render();
            }
          });
        }

        // Initial background sync of user data
        if (state.isSuperAdmin) {
          state.syncCustomProfilesToCloud();
        }
        await this.syncCloudDataForUser();
        this.render();
      } catch (err) {
        console.error('Auth verification error:', err);
      }
    });
  }

  updateCloudSyncStatus(status, details = '') {
    this.cloudSyncState = status;
    const badge = document.getElementById('drawer-sync-status-badge');
    const text = document.getElementById('drawer-sync-status-text');
    const icon = document.getElementById('drawer-sync-icon');

    if (status === 'syncing') {
      if (badge) {
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold';
        badge.textContent = 'מסנכרן...';
      }
      if (text) text.textContent = 'מעלה ומוריד נתונים מהענן...';
      if (icon) icon.classList.add('animate-spin');
    } else if (status === 'synced') {
      if (badge) {
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold';
        badge.textContent = 'מסונכרן ✓';
      }
      if (text) {
        const timeStr = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        text.textContent = `סונכרן בהצלחה ב-${timeStr}`;
      }
      if (icon) icon.classList.remove('animate-spin');
    } else if (status === 'error') {
      if (badge) {
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 font-bold';
        badge.textContent = 'שגיאת חיבור';
      }
      if (text) text.textContent = details ? `שגיאה: ${details}` : 'בדוק חיבור אינטרנט';
      if (icon) icon.classList.remove('animate-spin');
    }
  }

  async syncCloudDataForUser(targetDate = null, isManualSync = false) {
    if (!state.authUser) {
      if (isManualSync) {
        this.showToast('אינך מחובר לחשבון Google. יש להתחבר תחילה כדי לסנכרן עם הענן.', 'warning');
      }
      return { success: false, reason: 'unauthenticated' };
    }
    const userEmail = state.getUserEmailKey();
    if (!userEmail) return { success: false, reason: 'no_email' };

    try {
      this.updateCloudSyncStatus('syncing');
      const user = state.activeUser;
      const dateToSync = targetDate || state.selectedDate;

      // 1. Gather all local dates for this activeUser from localStorage
      const localDatesSet = new Set();
      const mealPrefix = `ag_meals_${user}_`;
      const workoutPrefix = `ag_workout_${user}_`;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith(mealPrefix)) {
          const d = key.replace(mealPrefix, '');
          if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) localDatesSet.add(d);
        } else if (key.startsWith(workoutPrefix)) {
          const d = key.replace(workoutPrefix, '');
          if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) localDatesSet.add(d);
        }
      }
      if (dateToSync) localDatesSet.add(dateToSync);

      // 2. Fetch all daily logs from cloud
      const cloudDailyLogs = await fetchAllDailyLogsFromCloud(userEmail);
      const cloudMap = new Map();
      if (Array.isArray(cloudDailyLogs)) {
        cloudDailyLogs.forEach(log => {
          if (log && log.date) {
            cloudMap.set(log.date, log);
          }
        });
      }

      // If specific date requested and not yet in cloudMap, single fetch
      if (dateToSync && !cloudMap.has(dateToSync)) {
        const single = await fetchDailyLogFromCloud(userEmail, dateToSync);
        if (single && single.date) cloudMap.set(single.date, single);
      }

      // Merge all dates (both directions!)
      const allDates = new Set([...localDatesSet, ...cloudMap.keys()]);
      let uploadedDailyCount = 0;
      let downloadedDailyCount = 0;

      for (const d of allDates) {
        const cloudLog = cloudMap.get(d) || null;
        const localMeals = getMealsForDate(user, d);
        const localWorkout = getWorkoutForDate(user, d);

        let mealsNeedUpload = false;
        let mergedMeals = [...localMeals];

        if (cloudLog && Array.isArray(cloudLog.meals) && cloudLog.meals.length > 0) {
          const mealMap = new Map();
          // Put cloud meals in map
          cloudLog.meals.forEach(m => {
            const mKey = m.id || `${m.name}_${m.time || ''}`;
            mealMap.set(mKey, m);
          });
          // Merge local meals
          localMeals.forEach(m => {
            const mKey = m.id || `${m.name}_${m.time || ''}`;
            if (!mealMap.has(mKey)) {
              mealsNeedUpload = true; // Local has a meal that cloud was missing!
            }
            mealMap.set(mKey, m);
          });
          mergedMeals = Array.from(mealMap.values());
          if (mergedMeals.length !== localMeals.length) {
            downloadedDailyCount++;
          }
          setMealsForDate(user, d, mergedMeals);
        } else if (localMeals.length > 0) {
          // Cloud has no meals for this date, but local does!
          mealsNeedUpload = true;
        }

        // Merge workouts
        let workoutNeedUpload = false;
        let mergedWorkout = { ...localWorkout };
        if (cloudLog && cloudLog.workout) {
          const cw = cloudLog.workout;
          if (cw.workedOut && !localWorkout.workedOut) {
            mergedWorkout.workedOut = true;
          }
          if ((cw.steps || 0) > (localWorkout.steps || 0)) {
            mergedWorkout.steps = cw.steps;
          }
          if ((cw.smartwatchCalories || 0) > (localWorkout.smartwatchCalories || 0)) {
            mergedWorkout.smartwatchCalories = cw.smartwatchCalories;
          }
          if ((cw.strengthDuration || 0) > (localWorkout.strengthDuration || 0)) {
            mergedWorkout.strengthDuration = cw.strengthDuration;
          }
          if (Array.isArray(cw.strengthMuscles) && cw.strengthMuscles.length > 0) {
            mergedWorkout.strengthMuscles = Array.from(new Set([...(localWorkout.strengthMuscles || []), ...cw.strengthMuscles]));
          }
          if (cw.notes && !localWorkout.notes) {
            mergedWorkout.notes = cw.notes;
          }
          saveWorkoutForDate(user, d, mergedWorkout);
        } else if (hasWorkoutForDate(user, d)) {
          workoutNeedUpload = true;
        }

        // PUSH to cloud if local had data that wasn't in cloud
        if (mealsNeedUpload || workoutNeedUpload || (cloudLog && localMeals.length > (cloudLog.meals?.length || 0))) {
          await syncDailyLogToCloud(userEmail, d, {
            meals: mergedMeals,
            workout: mergedWorkout,
            totalMacros: calculateDailyMacros(mergedMeals)
          });
          uploadedDailyCount++;
        }
      }

      // 3. Two-way Tanita sync
      const cloudTanita = await fetchTanitaLogsFromCloud(userEmail);
      const localTanita = getTanitaHistory(user);
      const tanitaMap = new Map();
      const cloudTanitaKeys = new Set();

      if (Array.isArray(cloudTanita)) {
        cloudTanita.forEach(t => {
          const key = t.id || t.date;
          tanitaMap.set(key, t);
          cloudTanitaKeys.add(key);
        });
      }

      let uploadedTanitaCount = 0;
      for (const lt of localTanita) {
        const key = lt.id || lt.date;
        if (!cloudTanitaKeys.has(key)) {
          // Local Tanita entry does not exist in cloud! PUSH to cloud!
          try {
            await syncTanitaEntryToCloud(userEmail, lt);
            uploadedTanitaCount++;
          } catch (e) {
            console.warn('Tanita push notice:', e);
          }
        }
        tanitaMap.set(key, lt);
      }

      const mergedTanita = Array.from(tanitaMap.values());
      mergedTanita.sort((a, b) => new Date(b.date) - new Date(a.date));
      const key = `ag_tanita_${user}`;
      const { setStoredItem } = await import('./storage.js');
      setStoredItem(key, mergedTanita);

      // 4. Sync Profile targets
      const cloudTargets = await fetchTargetsFromCloud(userEmail);
      if (cloudTargets) {
        const updates = {};
        if (cloudTargets.targetWeight) updates.targetWeight = Number(cloudTargets.targetWeight);
        if (cloudTargets.targetKcal) updates.targetKcal = Number(cloudTargets.targetKcal);
        if (cloudTargets.targetProtein) updates.targetProtein = Number(cloudTargets.targetProtein);
        if (cloudTargets.targetCarbs) updates.targetCarbs = Number(cloudTargets.targetCarbs);
        if (cloudTargets.targetFat) updates.targetFat = Number(cloudTargets.targetFat);
        if (cloudTargets.targetVisceralFat !== undefined) updates.targetVisceralFat = Number(cloudTargets.targetVisceralFat);
        if (cloudTargets.targetBodyFat !== undefined) updates.targetBodyFat = Number(cloudTargets.targetBodyFat);
        if (cloudTargets.focus) updates.focus = cloudTargets.focus;
        if (Object.keys(updates).length > 0) {
          state.updateCurrentProfile(updates);
        }
      }

      // 5. Sync custom user profiles from cloud
      const cloudProfiles = await fetchProfilesFromCloud();
      if (Array.isArray(cloudProfiles) && cloudProfiles.length > 0) {
        state.mergeCloudCustomProfiles(cloudProfiles);
      }

      this.lastCloudSyncTime = new Date();
      this.updateCloudSyncStatus('synced');

      if (isManualSync) {
        const detailsParts = [];
        if (uploadedDailyCount > 0) detailsParts.push(`${uploadedDailyCount} ימי יומן עלו לענן`);
        if (uploadedTanitaCount > 0) detailsParts.push(`${uploadedTanitaCount} שקילות עלו לענן`);
        if (downloadedDailyCount > 0) detailsParts.push(`נתונים עודכנו מהענן`);
        const msg = detailsParts.length > 0 
          ? `סנכרון ענן הושלם! ${detailsParts.join(', ')}. כל המכשירים מעודכנים.`
          : 'סנכרון ענן הושלם בהצלחה! הנתונים בטלפון ובמחשב מסונכרנים לחלוטין.';
        this.showToast(msg, 'success');
        this.render();
      }

      return {
        success: true,
        uploadedDailyCount,
        downloadedDailyCount,
        uploadedTanitaCount
      };
    } catch (err) {
      console.warn('Background cloud sync notice:', err);
      this.updateCloudSyncStatus('error', err.message || 'שגיאה');
      if (isManualSync) {
        this.showToast(`שגיאה בסנכרון ענן: ${err.message || 'בדוק חיבור אינטרנט'}`, 'error');
      }
      return { success: false, error: err };
    }
  }

  updateHeaderHeight() {
    const header = document.querySelector('header');
    if (header) {
      const height = Math.ceil(header.getBoundingClientRect().height);
      if (height > 0) {
        document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
    }
  }

  showToast(message = 'הארוחה נוספה בהצלחה! ✓', type = 'success') {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(50);
      }
    } catch (e) {
      // Haptic vibration fallback
    }

    const toast = document.getElementById('global-toast');
    if (!toast) return;

    if (type === 'success') {
      toast.className = 'fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 transform translate-y-0 opacity-100 px-4 py-3 rounded-xl shadow-2xl text-xs font-black flex items-center gap-2 border bg-emerald-950/95 text-emerald-300 border-emerald-500/50 max-w-sm w-auto mx-4 justify-center';
      toast.innerHTML = `<span class="text-base font-black">✓</span> <span>${message}</span>`;
    } else if (type === 'error') {
      toast.className = 'fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 transform translate-y-0 opacity-100 px-4 py-3 rounded-xl shadow-2xl text-xs font-black flex items-center gap-2 border bg-red-950/95 text-red-300 border-red-500/50 max-w-sm w-auto mx-4 justify-center';
      toast.innerHTML = `<span class="text-base">⚠️</span> <span>${message}</span>`;
    } else {
      toast.className = 'fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 transform translate-y-0 opacity-100 px-4 py-3 rounded-xl shadow-2xl text-xs font-black flex items-center gap-2 border bg-cyan-950/95 text-cyan-300 border-cyan-500/50 max-w-sm w-auto mx-4 justify-center';
      toast.innerHTML = `<span class="text-base">ℹ️</span> <span>${message}</span>`;
    }

    clearTimeout(this.toastTimer);
    // 2.5 seconds duration as requested
    this.toastTimer = setTimeout(() => {
      toast.className = 'fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 transform -translate-y-10 opacity-0 px-4 py-3 rounded-xl shadow-2xl text-xs font-black flex items-center gap-2 border max-w-sm w-full mx-4 justify-center';
    }, 2500);
  }

  formatHebrewDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  isAccordionOpen(key, defaultOpen = true) {
    try {
      const val = localStorage.getItem(`ag_acc_${key}`);
      if (val === null) {
        if (key === 'meals_ready_meals') {
          const oldVal = localStorage.getItem('ag_acc_meals_presets');
          if (oldVal !== null) return oldVal === 'true';
        }
        return defaultOpen;
      }
      return val === 'true';
    } catch (e) {
      return defaultOpen;
    }
  }

  setAccordionOpen(key, isOpen) {
    try {
      localStorage.setItem(`ag_acc_${key}`, isOpen ? 'true' : 'false');
    } catch (e) {}
  }

  getNutritionCardsOrder() {
    const defaultOrder = ['ready_meals', 'single_items', 'custom_meal', 'herbalife'];
    try {
      const saved = JSON.parse(localStorage.getItem('nutrition_cards_order') || 'null');
      if (Array.isArray(saved) && saved.length > 0) {
        const valid = ['ready_meals', 'single_items', 'custom_meal', 'herbalife'];
        const filtered = saved.filter(id => valid.includes(id));
        valid.forEach(id => {
          if (!filtered.includes(id)) filtered.push(id);
        });
        return filtered;
      }
    } catch (e) {}
    return defaultOrder;
  }

  setNutritionCardsOrder(newOrder) {
    try {
      localStorage.setItem('nutrition_cards_order', JSON.stringify(newOrder));
    } catch (e) {}
  }

  moveNutritionCard(cardId, direction) {
    const isGranit = state.activeUser === 'Granit';
    const isHerbalifeEnabled = isGranit || localStorage.getItem('nutrition_show_herbalife') === 'true';
    const order = this.getNutritionCardsOrder();
    const visible = order.filter(id => id !== 'herbalife' || isHerbalifeEnabled);
    const idx = visible.indexOf(cardId);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= visible.length) return;

    // Swap items in visible list
    const temp = visible[idx];
    visible[idx] = visible[targetIdx];
    visible[targetIdx] = temp;

    // Merge into full order preserving any hidden items
    const fullOrder = [...visible];
    order.forEach(id => {
      if (!fullOrder.includes(id)) fullOrder.push(id);
    });

    this.setNutritionCardsOrder(fullOrder);
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    } catch (e) {}
    this.render();
    this.showToast('סדר הכרטיסים עודכן בהצלחה! ✓');
  }

  bindAccordion(elementId, key) {
    const el = document.getElementById(elementId);
    if (el) {
      el.addEventListener('toggle', () => {
        this.setAccordionOpen(key, el.open);
      });
    }
  }

  changeDateByDays(offset) {
    const cur = new Date(state.selectedDate || Date.now());
    cur.setDate(cur.getDate() + offset);
    const newDateStr = cur.toISOString().split('T')[0];
    state.setSelectedDate(newDateStr);
    this.showToast(`תאריך עודכן: ${this.formatHebrewDate(newDateStr)} ✓`);
  }

  updateHeaderDateText() {
    const el = document.getElementById('header-current-date-text');
    if (!el) return;
    const todayStr = new Date().toISOString().split('T')[0];
    if (state.selectedDate === todayStr) {
      el.textContent = 'היום';
    } else {
      const parts = state.selectedDate.split('-');
      el.textContent = `${parts[2]}/${parts[1]}`;
    }
  }

  openCalendarModal() {
    const modal = document.getElementById('calendar-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const d = new Date(state.selectedDate || Date.now());
    this.calendarYear = d.getFullYear();
    this.calendarMonth = d.getMonth();
    this.renderCalendarGrid();
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  closeCalendarModal() {
    const modal = document.getElementById('calendar-modal');
    if (modal) modal.classList.add('hidden');
  }

  initCalendarListeners() {
    const headerCalBtn = document.getElementById('header-calendar-btn');
    if (headerCalBtn) {
      headerCalBtn.addEventListener('click', () => this.openCalendarModal());
    }

    const closeBtn = document.getElementById('close-calendar-modal-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeCalendarModal());
    }

    const modal = document.getElementById('calendar-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeCalendarModal();
      });
    }

    const prevMonthBtn = document.getElementById('cal-prev-month-btn');
    if (prevMonthBtn) {
      prevMonthBtn.addEventListener('click', () => {
        this.calendarMonth--;
        if (this.calendarMonth < 0) {
          this.calendarMonth = 11;
          this.calendarYear--;
        }
        this.renderCalendarGrid();
      });
    }

    const nextMonthBtn = document.getElementById('cal-next-month-btn');
    if (nextMonthBtn) {
      nextMonthBtn.addEventListener('click', () => {
        this.calendarMonth++;
        if (this.calendarMonth > 11) {
          this.calendarMonth = 0;
          this.calendarYear++;
        }
        this.renderCalendarGrid();
      });
    }

    const todayBtn = document.getElementById('cal-today-btn');
    if (todayBtn) {
      todayBtn.addEventListener('click', () => {
        const todayStr = new Date().toISOString().split('T')[0];
        state.setSelectedDate(todayStr);
        this.closeCalendarModal();
        try {
          if (navigator.vibrate) navigator.vibrate(40);
        } catch (e) {}
        this.showToast(`חזרת לתאריך היום (${this.formatHebrewDate(todayStr)})`);
      });
    }
  }

  initThemeListeners() {
    const headerThemeBtn = document.getElementById('header-theme-btn');
    if (headerThemeBtn) {
      headerThemeBtn.addEventListener('click', () => this.openThemeModal());
    }

    const closeBtn = document.getElementById('close-theme-modal-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeThemeModal());
    }

    const modal = document.getElementById('theme-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeThemeModal();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const themeModal = document.getElementById('theme-modal');
        if (themeModal && !themeModal.classList.contains('hidden')) {
          this.closeThemeModal();
        }
      }
    });
  }

  openThemeModal() {
    const modal = document.getElementById('theme-modal');
    if (!modal) return;
    this.renderThemeOptions();
    modal.classList.remove('hidden');
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  closeThemeModal() {
    const modal = document.getElementById('theme-modal');
    if (modal) modal.classList.add('hidden');
  }

  renderThemeOptions() {
    const container = document.getElementById('theme-options-container');
    if (!container) return;

    const currentThemeId = state.theme || 'slate';

    const isModeLight = isThemeLight(currentThemeId);

    container.innerHTML = AVAILABLE_THEMES.map(t => {
      const isActive = currentThemeId === t.id;
      const isTargetLight = isThemeLight(t.id);
      
      const swatchBg = t.id === 'oled' ? '#000000' : t.id === 'slate' ? '#0f172a' : t.id === 'cream' ? '#faf7f2' : '#ffffff';
      const swatchBorder = isTargetLight ? (t.id === 'emerald' ? '#86efac' : t.id === 'midnight' ? '#7dd3fc' : t.id === 'cream' ? '#fde68a' : '#cbd5e1') : (t.id === 'oled' ? '#262626' : '#334155');

      let btnClass = '';
      if (isModeLight) {
        btnClass = isActive
          ? 'bg-emerald-50 border-emerald-500 text-emerald-950 ring-2 ring-emerald-500/40'
          : 'bg-white border-slate-200 hover:border-slate-300 text-slate-800';
      } else {
        btnClass = isActive
          ? 'bg-emerald-500/15 border-emerald-500 text-slate-100 ring-2 ring-emerald-500/40'
          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 text-slate-300';
      }

      return `
        <button
          type="button"
          data-theme-choice="${t.id}"
          class="w-full p-3.5 rounded-xl border text-right transition-all cursor-pointer flex items-center justify-between ${btnClass}"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm shrink-0"
              style="background: ${swatchBg}; border-color: ${swatchBorder}; color: ${t.accentColor};"
            >
              <i data-lucide="${t.icon}" class="w-5 h-5"></i>
            </div>
            <div>
              <div class="text-xs font-bold flex items-center gap-1.5">
                <span class="${isModeLight ? (isActive ? 'text-emerald-950' : 'text-slate-900') : ''}">${t.name}</span>
                ${t.badge ? `<span class="text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? (isModeLight ? 'bg-emerald-200 text-emerald-900 font-black' : 'bg-emerald-500/25 text-emerald-300 font-extrabold') : (isModeLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-400')}">${t.badge}</span>` : ''}
              </div>
              <div class="text-[11px] ${isModeLight ? 'text-slate-500' : 'text-slate-400'} mt-0.5">${t.desc}</div>
            </div>
          </div>
          <div class="shrink-0 mr-2">
            ${isActive ? `<span class="${isModeLight ? 'text-emerald-700' : 'text-emerald-400'} font-black flex items-center gap-1 text-sm"><i data-lucide="check" class="w-4 h-4"></i> פעיל</span>` : `<span class="w-4 h-4 rounded-full border ${isModeLight ? 'border-slate-300' : 'border-slate-700'} inline-block"></span>`}
          </div>
        </button>
      `;
    }).join('');

    container.querySelectorAll('[data-theme-choice]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const themeId = e.currentTarget.getAttribute('data-theme-choice');
        state.setTheme(themeId);
        this.renderThemeOptions();
        this.renderActiveView();
        const selected = AVAILABLE_THEMES.find(t => t.id === themeId);
        this.showToast(`ערכת נושא הוחלפה ל-${selected?.name || themeId} ✓`);
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          window.lucide.createIcons();
        }
      });
    });
  }

  renderCalendarGrid() {
    const grid = document.getElementById('cal-days-grid');
    const label = document.getElementById('cal-month-year-label');
    const selectedInfo = document.getElementById('cal-selected-info');
    if (!grid || !label) return;

    const hebrewMonths = [
      'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
      'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
    ];
    label.textContent = `${hebrewMonths[this.calendarMonth]} ${this.calendarYear}`;

    if (selectedInfo) {
      selectedInfo.textContent = `נבחר: ${this.formatHebrewDate(state.selectedDate)}`;
    }

    const firstDay = new Date(this.calendarYear, this.calendarMonth, 1).getDay();
    const daysInMonth = new Date(this.calendarYear, this.calendarMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(this.calendarYear, this.calendarMonth, 0).getDate();

    const todayStr = new Date().toISOString().split('T')[0];
    const user = state.activeUser;
    const tanitaHistory = getTanitaHistory(user);
    const tanitaDates = new Set(tanitaHistory.map(h => h.date));

    let html = '';

    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      html += `<div class="cal-day-cell cal-day-other-month text-slate-600"><span class="text-[11px]">${d}</span></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const monthStr = String(this.calendarMonth + 1).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${this.calendarYear}-${monthStr}-${dayStr}`;

      const isToday = dateStr === todayStr;
      const isSelected = dateStr === state.selectedDate;
      const hasMeals = hasMealsForDate(user, dateStr);
      const hasTanita = tanitaDates.has(dateStr);
      const hasWorkout = hasWorkoutForDate(user, dateStr);

      const cellClasses = ['cal-day-cell', 'cal-day-btn'];
      if (isSelected) cellClasses.push('cal-day-selected');
      if (isToday) cellClasses.push('cal-day-today');

      html += `
        <div data-cal-date="${dateStr}" class="${cellClasses.join(' ')}">
          <span class="text-xs font-bold">${day}</span>
          <div class="cal-day-dots">
            ${hasMeals ? `<span class="cal-dot-meal" title="ארוחות נרשמו"></span>` : ''}
            ${hasTanita ? `<span class="cal-dot-tanita" title="מדידת טניטה"></span>` : ''}
            ${hasWorkout ? `<span class="cal-dot-workout" title="אימון נרשם"></span>` : ''}
          </div>
        </div>
      `;
    }

    const totalCells = firstDay + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
      html += `<div class="cal-day-cell cal-day-other-month text-slate-600"><span class="text-[11px]">${day}</span></div>`;
    }

    grid.innerHTML = html;

    grid.querySelectorAll('[data-cal-date]').forEach(cell => {
      cell.addEventListener('click', (e) => {
        const dateStr = e.currentTarget.getAttribute('data-cal-date');
        state.setSelectedDate(dateStr);
        this.closeCalendarModal();
        try {
          if (navigator.vibrate) navigator.vibrate(40);
        } catch (err) {}
        this.showToast(`נבחר תאריך: ${this.formatHebrewDate(dateStr)}`);
      });
    });
  }

  getCalendarStripHTML() {
    const user = state.activeUser;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const selectedDateStr = state.selectedDate || todayStr;

    // Calculate Sunday (day 0) of the week containing the selected date
    const [sYear, sMonth, sDay] = selectedDateStr.split('-').map(Number);
    const refDate = new Date(sYear, sMonth - 1, sDay);
    const dayOfWeek = refDate.getDay(); // 0 is Sunday (יום א'), 6 is Saturday (יום ש')
    const sunday = new Date(sYear, sMonth - 1, sDay - dayOfWeek);

    const tanitaHistory = getTanitaHistory(user);
    const tanitaDates = new Set(tanitaHistory.map(h => h.date));
    const dayNames = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayOfMonth = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${dayOfMonth}`;

      days.push({
        dateStr,
        dayName: dayNames[i],
        dayNum: d.getDate(),
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDateStr,
        hasMeals: hasMealsForDate(user, dateStr),
        hasTanita: tanitaDates.has(dateStr),
        hasWorkout: hasWorkoutForDate(user, dateStr)
      });
    }

    return `
      <div class="dashboard-card py-3 px-3 sm:px-4 bg-slate-900/90 border-slate-800">
        <div class="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-800/80">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <i data-lucide="calendar" class="w-3.5 h-3.5 text-emerald-400"></i>
              <span>סרגל שבועי (א׳ - ש׳)</span>
            </span>
            <span class="text-[11px] text-slate-400">תאריך פעיל: <strong class="text-emerald-400">${this.formatHebrewDate(selectedDateStr)}</strong></span>
          </div>
          <div class="flex items-center gap-1.5">
            <button id="strip-prev-week-btn" type="button" aria-label="שבוע קודם (-7 ימים)" title="שבוע קודם (-7 ימים)" class="w-7 h-7 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer border border-slate-700/60">
              <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
            </button>
            <button id="strip-today-btn" type="button" aria-label="חזור להיום" title="חזור להיום" class="text-[11px] font-bold px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer">
              היום
            </button>
            <button id="strip-next-week-btn" type="button" aria-label="שבוע הבא (+7 ימים)" title="שבוע הבא (+7 ימים)" class="w-7 h-7 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer border border-slate-700/60">
              <i data-lucide="chevron-left" class="w-3.5 h-3.5"></i>
            </button>
            <button id="strip-open-calendar-btn" type="button" aria-label="פתח לוח שנה מלא" class="text-xs font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer py-1 px-2.5 rounded-lg bg-cyan-950/40 border border-cyan-500/30">
              <span>לוח שנה</span>
              <i data-lucide="calendar-days" class="w-3 h-3"></i>
            </button>
          </div>
        </div>

        <div class="weekly-date-strip-grid w-full" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; align-items: stretch;">
          ${days.map(d => {
            let cardClasses = 'weekly-day-card cal-day-btn min-h-[84px] h-[88px] w-full rounded-xl transition-all cursor-pointer p-1.5 sm:p-2 flex flex-col justify-between items-center select-none border ';
            let topSlotColor = '';
            let middleSlotColor = '';
            let dotClass = '';
            let tanitaDotClass = '';
            let workoutDotClass = '';

            if (d.isSelected && d.isToday) {
              cardClasses += 'weekly-day-selected weekly-day-today bg-emerald-500 text-slate-950 font-extrabold border-emerald-400 ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950 shadow-md shadow-emerald-500/30';
              topSlotColor = 'text-slate-950 font-bold';
              middleSlotColor = 'text-slate-950 font-extrabold';
              dotClass = 'bg-slate-950';
              tanitaDotClass = 'bg-slate-950';
              workoutDotClass = 'bg-slate-950';
            } else if (d.isSelected) {
              cardClasses += 'weekly-day-selected bg-emerald-500 text-slate-950 font-extrabold border-emerald-400 shadow-md shadow-emerald-500/30';
              topSlotColor = 'text-slate-950 font-bold';
              middleSlotColor = 'text-slate-950 font-extrabold';
              dotClass = 'bg-slate-950';
              tanitaDotClass = 'bg-slate-950';
              workoutDotClass = 'bg-slate-950';
            } else if (d.isToday) {
              cardClasses += 'weekly-day-today bg-slate-800/80 border-emerald-500 text-slate-100 font-bold ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-900 hover:bg-slate-700/80';
              topSlotColor = 'text-emerald-400 font-bold';
              middleSlotColor = 'text-slate-100 font-bold';
              dotClass = 'bg-emerald-400';
              tanitaDotClass = 'bg-cyan-400';
              workoutDotClass = 'bg-amber-400';
            } else {
              cardClasses += 'weekly-day-inactive bg-slate-800/40 border border-slate-700/50 text-slate-300 hover:bg-slate-800/70 hover:border-slate-600/60';
              topSlotColor = 'text-slate-400 font-medium';
              middleSlotColor = 'text-slate-200 font-bold';
              dotClass = 'bg-emerald-400';
              tanitaDotClass = 'bg-cyan-400';
              workoutDotClass = 'bg-amber-400';
            }

            return `
              <button
                type="button"
                data-strip-date="${d.dateStr}"
                class="${cardClasses}"
                style="height: 88px; display: flex; flex-direction: column; justify-content: space-between; align-items: center;"
                title="${d.isToday ? 'היום הנוכחי' : ''} ${d.dateStr}"
              >
                <!-- Top Slot: Day Name in a uniform single line -->
                <div class="weekly-day-slot-top text-xs font-medium whitespace-nowrap text-center ${topSlotColor}">
                  יום ${d.dayName}
                </div>

                <!-- Middle Slot: Day Number in bold prominent font -->
                <div class="weekly-day-slot-middle text-lg font-bold text-center leading-none my-auto ${middleSlotColor}">
                  ${d.dayNum}
                </div>

                <!-- Bottom Slot: Fixed-Height Status Container (h-4) Reserved for Dots -->
                <div class="weekly-day-slot-bottom h-4 w-full flex items-center justify-center gap-1 shrink-0">
                  ${d.hasMeals ? `<span class="w-1.5 h-1.5 rounded-full ${dotClass}" title="ארוחות נרשמו"></span>` : ''}
                  ${d.hasTanita ? `<span class="w-1.5 h-1.5 rounded-full ${tanitaDotClass}" title="מדידת טניטה"></span>` : ''}
                  ${d.hasWorkout ? `<span class="w-1.5 h-1.5 rounded-full ${workoutDotClass}" title="אימון / פעילות"></span>` : ''}
                </div>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  saveProfileFromModal() {
    const isGranit = state.activeUser === 'Granit';
    const profile = state.getCurrentProfile();

    const emailVal = document.getElementById('prof-email')?.value?.trim();
    const heightVal = document.getElementById('prof-height')?.value;
    const startWeightVal = document.getElementById('prof-start-weight')?.value;
    const targetWeightVal = document.getElementById('prof-target-weight')?.value;
    const visceralVal = document.getElementById('prof-target-visceral')?.value;
    const fatVal = document.getElementById('prof-target-body-fat')?.value;
    const focusVal = document.getElementById('prof-focus')?.value;

    const parseSanitizedFloat = (val, fallback) => {
      if (val === null || val === undefined || val === '') return fallback;
      const s = String(val).trim().replace(',', '.');
      const n = parseFloat(s);
      return isNaN(n) ? fallback : n;
    };

    const updatedData = {
      email: emailVal !== undefined ? emailVal.toLowerCase() : (profile.email || ''),
      height: parseSanitizedFloat(heightVal, isGranit ? 152 : 174),
      startWeight: parseSanitizedFloat(startWeightVal, isGranit ? 56 : 70),
      currentWeight: profile.currentWeight || parseSanitizedFloat(startWeightVal, isGranit ? 56 : 70),
      targetWeight: parseSanitizedFloat(targetWeightVal, isGranit ? 50 : 67),
      targetVisceralFat: parseSanitizedFloat(visceralVal, isGranit ? 3 : 4),
      targetBodyFat: parseSanitizedFloat(fatVal, isGranit ? 20.0 : 15.0),
      focus: (focusVal && focusVal.trim()) ? focusVal.trim() : (isGranit ? 'חיטוב ואיזון הרכב גוף' : 'הפחתת שומן בטני (ויסצראלי) תוך שמירה על מסת שריר'),
    };

    state.updateCurrentProfile(updatedData);

    const saveBtn = document.getElementById('save-profile-btn');
    const saveBtnText = document.getElementById('save-profile-btn-text');
    if (saveBtn) {
      saveBtn.className = 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs flex-1 sm:flex-initial flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px] min-w-[120px] font-black transition-all shadow-lg shadow-emerald-500/20';
      if (saveBtnText) saveBtnText.textContent = '✓ נשמר בהצלחה!';
    }

    const alertBox = document.getElementById('profile-modal-alert');
    if (alertBox) {
      alertBox.className = 'p-3 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-center block';
      alertBox.textContent = `✅ נתוני הפרופיל של ${profile.hebrewName} נשמרו בהצלחה! יעד משקל: ${updatedData.targetWeight} ק"ג, גובה: ${updatedData.height} ס"מ.`;
      alertBox.classList.remove('hidden');
    }

    this.showToast(`נתוני ${profile.hebrewName} נשמרו בהצלחה! (משקל יעד: ${updatedData.targetWeight} ק"ג, גובה: ${updatedData.height} ס"מ)`);

    setTimeout(() => {
      this.closeProfileModal();
      if (saveBtn) {
        saveBtn.className = 'btn-primary text-xs flex-1 sm:flex-initial flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px] min-w-[120px] font-bold';
        if (saveBtnText) saveBtnText.textContent = 'שמור שינויים';
      }
    }, 850);
  }

  initListeners() {
    this.updateProfileButtons();

    const headerSettingsBtn = document.getElementById('header-settings-btn');
    if (headerSettingsBtn) {
      headerSettingsBtn.addEventListener('click', () => this.openProfileModal('edit'));
    }

    const headerAddUserBtn = document.getElementById('header-add-user-btn');
    if (headerAddUserBtn) {
      headerAddUserBtn.addEventListener('click', () => this.openProfileModal('create'));
    }

    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        state.setActiveTab(tab);
      });
    });

    // Google Login button in overlay
    const googleLoginBtn = document.getElementById('google-login-btn');
    if (googleLoginBtn) {
      googleLoginBtn.addEventListener('click', async () => {
        const alertEl = document.getElementById('auth-overlay-alert');
        const spinner = document.getElementById('auth-loading-spinner');
        if (alertEl) {
          alertEl.classList.add('hidden');
          alertEl.textContent = '';
        }
        if (spinner) spinner.classList.remove('hidden');
        googleLoginBtn.disabled = true;

        try {
          const user = await signInWithGoogle();
          this.showToast(`שלום, ${user.displayName || 'חבר צוות'}! התחברת בהצלחה ✓`, 'success');
        } catch (err) {
          if (err.code === 'auth/unauthorized-domain' || err.isUnauthorizedDomain) {
            console.warn('Firebase unauthorized domain:', window.location.hostname);
            if (alertEl) {
              alertEl.classList.remove('hidden');
              alertEl.className = 'p-4 rounded-2xl text-xs transition-all text-right bg-amber-500/15 text-amber-200 border border-amber-500/40 space-y-2.5';
              const currentHost = window.location.hostname;
              alertEl.innerHTML = `
                <div class="flex items-center gap-2 font-bold text-amber-300 text-sm">
                  <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0"></i>
                  <span>הדומיין הנוכחי אינו מורשה ב-Firebase</span>
                </div>
                <p class="text-[11px] text-slate-300 leading-relaxed">
                  הדומיין טרם נוסף לרשימת <strong>Authorized Domains</strong> בפרויקט Firebase (<code class="text-amber-400">agm-fit</code>).
                </p>
                <div class="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-between gap-2 text-[11px] font-mono dir-ltr select-all">
                  <span id="domain-to-copy" class="text-emerald-400 truncate">${currentHost}</span>
                  <button type="button" id="copy-domain-btn" class="shrink-0 py-1 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-sans transition-colors cursor-pointer flex items-center gap-1">
                    <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                    <span id="copy-domain-text">העתק דומיין</span>
                  </button>
                </div>
                <div class="text-[11px] text-slate-400 space-y-1">
                  <div>1. היכנס אל <a href="https://console.firebase.google.com/project/agm-fit/authentication/settings" target="_blank" rel="noopener noreferrer" class="text-cyan-400 hover:underline font-bold inline-flex items-center gap-1">Firebase Console > Settings ↗</a></div>
                  <div>2. תחת <strong>Authorized domains</strong> לחץ <strong>Add domain</strong> והדבק את הדומיין.</div>
                </div>
              `;

              refreshIcons();

              const copyBtn = document.getElementById('copy-domain-btn');
              if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                  try {
                    await navigator.clipboard.writeText(currentHost);
                    const copyText = document.getElementById('copy-domain-text');
                    if (copyText) copyText.textContent = 'הועתק! ✓';
                    setTimeout(() => {
                      if (copyText) copyText.textContent = 'העתק דומיין';
                    }, 2500);
                  } catch (copyErr) {
                    this.showToast('העתק ידנית: ' + currentHost, 'info');
                  }
                });
              }
            }
            this.showToast('הדומיין הנוכחי אינו מורשה ב-Firebase Console.', 'warning');
          } else if (err.message === 'UNAUTHORIZED_USER' || err.isUnauthorized) {
            console.warn('Login access denied for unauthorized user:', err.customMessage);
            if (alertEl) {
              alertEl.classList.remove('hidden');
              alertEl.className = 'p-3 rounded-xl text-xs font-bold transition-all text-center bg-red-500/20 text-red-300 border border-red-500/30';
              alertEl.textContent = err.customMessage || 'חשבון זה אינו מורשה במערכת. יש לפנות לאריק (Super Admin) לקבלת הרשאה.';
            }
            this.showToast(err.customMessage || 'אין לך הרשאה לגשת למערכת', 'error');
          } else if (err.code === 'auth/popup-closed-by-user') {
            console.warn('Login popup closed by user');
            if (alertEl) {
              alertEl.classList.remove('hidden');
              alertEl.className = 'p-3 rounded-xl text-xs font-bold transition-all text-center bg-amber-500/20 text-amber-300 border border-amber-500/30';
              alertEl.textContent = 'חלון ההתחברות נסגר בטרם הושלמה הפעולה.';
            }
          } else {
            console.error('Login error:', err);
            if (alertEl) {
              alertEl.classList.remove('hidden');
              alertEl.className = 'p-3 rounded-xl text-xs font-bold transition-all text-center bg-red-500/20 text-red-300 border border-red-500/30';
              alertEl.textContent = 'שגיאה בהתחברות: ' + (err.message || 'נסה שוב');
            }
            this.showToast(err.customMessage || 'ההתחברות נכשלה', 'error');
          }
        } finally {
          if (spinner) spinner.classList.add('hidden');
          googleLoginBtn.disabled = false;
        }
      });
    }

    // Logout button in header (fallback if present)
    const logoutBtn = document.getElementById('header-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await logOut();
        state.setAuthUser(null);
        const overlay = document.getElementById('auth-login-overlay');
        const headerAuth = document.getElementById('header-auth-user');
        if (overlay) overlay.classList.remove('hidden');
        if (headerAuth) {
          headerAuth.classList.add('hidden');
          headerAuth.classList.remove('flex');
        }
        this.showToast('התנתקת מהמערכת בהצלחה', 'info');
        this.render();
      });
    }

    this.initUserDropdownListeners();
    this.initHamburgerMenuListeners();
    this.initDeleteUserModalListeners();
  }

  initModalListeners() {
    const modal = document.getElementById('profile-modal');
    const closeBtn = document.getElementById('close-profile-modal-btn');
    const cancelBtn = document.getElementById('cancel-profile-btn');
    const form = document.getElementById('profile-form');
    const resetBtn = document.getElementById('reset-profile-btn');
    const targetWeightInput = document.getElementById('prof-target-weight');

    if (closeBtn) closeBtn.addEventListener('click', () => this.closeProfileModal());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeProfileModal());

    // Tanita Metric Info Modal (? Modal) close listeners
    const closeTanitaInfoBtn = document.getElementById('close-tanita-info-modal-btn');
    const closeTanitaInfoBottomBtn = document.getElementById('close-tanita-info-bottom-btn');
    const tanitaInfoModal = document.getElementById('tanita-info-modal');

    if (closeTanitaInfoBtn) closeTanitaInfoBtn.addEventListener('click', () => this.closeTanitaInfoModal());
    if (closeTanitaInfoBottomBtn) closeTanitaInfoBottomBtn.addEventListener('click', () => this.closeTanitaInfoModal());
    if (tanitaInfoModal) {
      tanitaInfoModal.addEventListener('click', (e) => {
        if (e.target === tanitaInfoModal) this.closeTanitaInfoModal();
      });
    }

    // Tab buttons
    const tabEditBtn = document.getElementById('modal-tab-edit-btn');
    const tabCreateBtn = document.getElementById('modal-tab-create-btn');
    const tabManageBtn = document.getElementById('modal-tab-manage-btn');
    const gotoCreateBtn = document.getElementById('modal-goto-create-btn');
    const manageGotoCreateBtn = document.getElementById('modal-manage-goto-create-btn');
    const cancelCreateBtn = document.getElementById('modal-cancel-create-btn');

    if (tabEditBtn) tabEditBtn.addEventListener('click', () => this.switchModalTab('edit'));
    if (tabCreateBtn) tabCreateBtn.addEventListener('click', () => this.switchModalTab('create'));
    if (tabManageBtn) tabManageBtn.addEventListener('click', () => this.switchModalTab('manage'));
    if (gotoCreateBtn) gotoCreateBtn.addEventListener('click', () => this.switchModalTab('create'));
    if (manageGotoCreateBtn) manageGotoCreateBtn.addEventListener('click', () => this.switchModalTab('create'));
    if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', () => this.switchModalTab('edit'));

    // Modal Create User Form
    const modalCreateForm = document.getElementById('modal-create-user-form');
    if (modalCreateForm) {
      modalCreateForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const rawName = document.getElementById('modal-new-name')?.value?.trim();
        const hebrewName = document.getElementById('modal-new-hebrew-name')?.value?.trim();
        const email = document.getElementById('modal-new-email')?.value?.trim() || '';
        const gender = document.getElementById('modal-new-gender')?.value || 'male';
        const height = Number(document.getElementById('modal-new-height')?.value) || 170;
        const startWeight = Number(document.getElementById('modal-new-start-weight')?.value) || 75;
        const targetWeight = Number(document.getElementById('modal-new-target-weight')?.value) || 68;
        const focus = document.getElementById('modal-new-focus')?.value?.trim() || '';

        const alertBox = document.getElementById('modal-create-alert');

        if (!rawName || !hebrewName) {
          if (alertBox) {
            alertBox.className = 'p-3 rounded-xl text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/40 text-center';
            alertBox.textContent = 'נא למלא מזהה באנגלית ושם בעברית';
            alertBox.classList.remove('hidden');
          }
          return;
        }

        const newProfile = state.createUser({
          name: rawName,
          hebrewName,
          email,
          gender,
          height,
          startWeight,
          targetWeight,
          focus
        });

        this.showToast(`המשתמש ${newProfile.hebrewName} הוקם בהצלחה! הפרופיל פעיל כעת ✓`, 'success');
        modalCreateForm.reset();
        this.switchModalTab('edit');
        this.render();
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeProfileModal();
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        this.closeProfileModal();
      }
    });

    if (targetWeightInput) {
      targetWeightInput.addEventListener('input', () => {
        this.updateModalAutoMacroPreview();
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveProfileFromModal();
      });
    }

    const saveProfileBtn = document.getElementById('save-profile-btn');
    if (saveProfileBtn) {
      saveProfileBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.saveProfileFromModal();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!this.confirmingModalProfileReset) {
          this.confirmingModalProfileReset = true;
          const originalText = resetBtn.textContent;
          resetBtn.textContent = 'לחץ שוב לאישור איפוס';
          setTimeout(() => {
            this.confirmingModalProfileReset = false;
            if (resetBtn) resetBtn.textContent = originalText;
          }, 4000);
          return;
        }
        this.confirmingModalProfileReset = false;
        state.resetCurrentProfile();
        this.populateModalFields();
        this.showToast('נתוני הפרופיל אופסו לברירת מחדל בהצלחה! ✓', 'info');
        const alertBox = document.getElementById('profile-modal-alert');
        if (alertBox) {
          alertBox.className = 'p-3 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 text-center';
          alertBox.textContent = 'הפרופיל אופס לברירות המחדל בהצלחה.';
          alertBox.classList.remove('hidden');
        }
      });
    }
  }

  openProfileModal(tab = 'edit') {
    const modal = document.getElementById('profile-modal');
    if (!modal) return;

    const isSuper = state.canSwitchProfiles();
    const tabCreateBtn = document.getElementById('modal-tab-create-btn');
    const tabManageBtn = document.getElementById('modal-tab-manage-btn');
    const gotoCreateBtn = document.getElementById('modal-goto-create-btn');

    if (!isSuper) {
      if (tabCreateBtn) tabCreateBtn.classList.add('hidden');
      if (tabManageBtn) tabManageBtn.classList.add('hidden');
      if (gotoCreateBtn) gotoCreateBtn.classList.add('hidden');
      tab = 'edit';
    } else {
      if (tabCreateBtn) tabCreateBtn.classList.remove('hidden');
      if (tabManageBtn) tabManageBtn.classList.remove('hidden');
      if (gotoCreateBtn) gotoCreateBtn.classList.remove('hidden');
    }

    this.switchModalTab(tab);
    modal.classList.remove('hidden');
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  switchModalTab(tab) {
    const editView = document.getElementById('modal-view-edit');
    const createView = document.getElementById('modal-view-create');
    const manageView = document.getElementById('modal-view-manage');

    const editBtn = document.getElementById('modal-tab-edit-btn');
    const createBtn = document.getElementById('modal-tab-create-btn');
    const manageBtn = document.getElementById('modal-tab-manage-btn');

    if (!editView || !createView || !manageView) return;

    const activeEditClass = 'flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 bg-emerald-500 text-slate-950 shadow-sm cursor-pointer';
    const activeCreateClass = 'flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 bg-cyan-500 text-slate-950 shadow-sm cursor-pointer';
    const activeManageClass = 'flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 bg-amber-500 text-slate-950 shadow-sm cursor-pointer';
    const inactiveClass = 'flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer';

    editView.classList.add('hidden');
    createView.classList.add('hidden');
    manageView.classList.add('hidden');

    if (editBtn) editBtn.className = inactiveClass;
    if (createBtn) createBtn.className = inactiveClass;
    if (manageBtn) manageBtn.className = inactiveClass;

    if (tab === 'create') {
      createView.classList.remove('hidden');
      if (createBtn) createBtn.className = activeCreateClass;
      const alertBox = document.getElementById('modal-create-alert');
      if (alertBox) alertBox.classList.add('hidden');
      const nameInput = document.getElementById('modal-new-name');
      if (nameInput) setTimeout(() => nameInput.focus(), 80);
    } else if (tab === 'manage') {
      manageView.classList.remove('hidden');
      if (manageBtn) manageBtn.className = activeManageClass;
      this.renderModalUserList();
    } else {
      editView.classList.remove('hidden');
      if (editBtn) editBtn.className = activeEditClass;
      this.populateModalFields();
      const alertBox = document.getElementById('profile-modal-alert');
      if (alertBox) alertBox.classList.add('hidden');
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  renderModalUserList() {
    const container = document.getElementById('modal-users-list-container');
    if (!container) return;

    const allProfiles = state.getAllUserProfiles();
    container.innerHTML = allProfiles.map(u => {
      const isActive = state.activeUser === u.name;
      const isPermanent = u.name === 'Arik' || u.name === 'Granit';
      return `
        <div class="p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
          isActive 
            ? 'bg-slate-800/90 border-emerald-500/60 ring-2 ring-emerald-500/20' 
            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
        }">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg ${isActive ? 'bg-emerald-500 text-slate-950 font-black' : 'bg-slate-800 text-slate-200 font-bold'} flex items-center justify-center text-xs">
              ${u.hebrewName ? u.hebrewName.slice(0, 2) : u.name.slice(0, 2)}
            </div>
            <div>
              <div class="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                <span>${u.hebrewName || u.name}</span>
                <span class="text-[10px] font-mono text-slate-400">(${u.name})</span>
                ${isActive ? '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">פעיל</span>' : ''}
              </div>
              <div class="text-[10px] text-slate-400">
                ${u.gender === 'female' ? 'אישה' : 'גבר'} • יעד: <strong class="text-emerald-400 font-mono">${u.targetWeight} ק"ג</strong> (${u.targetKcal} kcal)
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1.5">
            ${!isActive ? `
              <button
                type="button"
                data-modal-select-user="${u.name}"
                class="btn-secondary text-xs py-1 px-3 cursor-pointer hover:border-emerald-500/50 hover:text-emerald-300 font-bold"
              >
                בחר
              </button>
            ` : `
              <span class="text-xs text-emerald-400 font-bold px-2 py-1">✓ נוכחי</span>
            `}
            ${!isPermanent ? `
              <button
                type="button"
                data-modal-delete-user="${u.name}"
                class="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg cursor-pointer transition-colors"
                title="מחק משתמש זה"
              >
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-modal-select-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const user = btn.getAttribute('data-modal-select-user');
        state.setActiveUser(user);
        const p = state.getCurrentProfile();
        this.showToast(`עברת לפרופיל ${p.hebrewName} ✓`, 'info');
        this.switchModalTab('edit');
        this.render();
      });
    });

    container.querySelectorAll('[data-modal-delete-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const user = btn.getAttribute('data-modal-delete-user');
        this.openDeleteUserDoubleConfirmModal(user);
      });
    });

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  openDeleteUserDoubleConfirmModal(userName) {
    if (!userName) return;
    if (userName === 'Arik' || userName === 'Granit') {
      this.showToast('פרופילי ברירת המחדל (Arik, Granit) מוגנים ולא ניתנים למחיקה.', 'warning');
      return;
    }
    if (!state.isSuperAdmin) {
      this.showToast('רק מנהל מערכת (אריק) רשאי למחוק משתמשים.', 'warning');
      return;
    }

    const profile = getUserProfile(userName);
    const modal = document.getElementById('delete-user-modal');
    const step1 = document.getElementById('delete-user-step-1');
    const step2 = document.getElementById('delete-user-step-2');
    const targetNameEl = document.getElementById('delete-user-target-name');
    const targetNameFinalEl = document.getElementById('delete-user-target-name-final');
    const emailInfoEl = document.getElementById('delete-user-target-email-info');
    const modalBox = document.getElementById('delete-user-modal-box');

    if (!modal || !step1 || !step2) return;

    this.pendingUserToDelete = userName;

    // Populate data
    const displayName = profile ? `${profile.hebrewName} (${userName})` : userName;
    if (targetNameEl) targetNameEl.textContent = displayName;
    if (targetNameFinalEl) targetNameFinalEl.textContent = displayName;
    if (emailInfoEl) {
      if (profile && profile.email) {
        emailInfoEl.innerHTML = `כתובת Gmail מקושרת: <strong class="text-cyan-400 font-mono">${profile.email}</strong>`;
        emailInfoEl.classList.remove('hidden');
      } else {
        emailInfoEl.classList.add('hidden');
      }
    }

    // Reset to Step 1
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    if (modalBox) {
      modalBox.className = 'modal-content w-full max-w-md bg-slate-900 border border-amber-500/40 rounded-2xl p-6 shadow-2xl space-y-5';
    }

    modal.classList.remove('hidden');
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  closeDeleteUserDoubleConfirmModal() {
    const modal = document.getElementById('delete-user-modal');
    if (modal) modal.classList.add('hidden');
    this.pendingUserToDelete = null;
  }

  initDeleteUserModalListeners() {
    const cancel1 = document.getElementById('delete-user-cancel-btn-1');
    const cancel2 = document.getElementById('delete-user-cancel-btn-2');
    const nextBtn = document.getElementById('delete-user-next-step-btn');
    const confirmBtn = document.getElementById('delete-user-confirm-final-btn');
    const modal = document.getElementById('delete-user-modal');
    const step1 = document.getElementById('delete-user-step-1');
    const step2 = document.getElementById('delete-user-step-2');
    const modalBox = document.getElementById('delete-user-modal-box');

    if (cancel1) {
      cancel1.addEventListener('click', () => this.closeDeleteUserDoubleConfirmModal());
    }
    if (cancel2) {
      cancel2.addEventListener('click', () => this.closeDeleteUserDoubleConfirmModal());
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeDeleteUserDoubleConfirmModal();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (step1 && step2) {
          step1.classList.add('hidden');
          step2.classList.remove('hidden');
          if (modalBox) {
            modalBox.className = 'modal-content w-full max-w-md bg-slate-900 border border-red-500/70 rounded-2xl p-6 shadow-2xl space-y-5';
          }
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
        }
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const userToDelete = this.pendingUserToDelete;
        if (!userToDelete) return;
        const profile = getUserProfile(userToDelete);
        const displayName = profile ? profile.hebrewName : userToDelete;
        const ok = state.deleteUser(userToDelete);
        this.closeDeleteUserDoubleConfirmModal();
        if (ok) {
          this.showToast(`פרופיל המשתמש ${displayName} נמחק לצמיתות מהמערכת ✓`, 'success');
          this.renderModalUserList();
          this.render();
        } else {
          this.showToast(`שגיאה במחיקת המשתמש ${displayName}`, 'error');
        }
      });
    }
  }

  closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (!modal) return;
    modal.classList.add('hidden');
  }

  openTanitaInfoModal(metricKey) {
    const modal = document.getElementById('tanita-info-modal');
    if (!modal) return;

    const info = TANITA_METRIC_INFO[metricKey] || TANITA_METRIC_INFO['weight'];
    const titleEl = document.getElementById('tanita-info-modal-title');
    const badgeEl = document.getElementById('tanita-info-modal-badge');
    const subtitleEl = document.getElementById('tanita-info-modal-subtitle');
    const iconContainer = document.getElementById('tanita-info-modal-icon-container');
    const bodyEl = document.getElementById('tanita-info-modal-body');

    if (titleEl) titleEl.textContent = info.title;
    if (badgeEl) badgeEl.textContent = info.category || 'מידע קליני';
    if (subtitleEl) subtitleEl.textContent = `יחידות מידה: ${info.unit}`;

    if (iconContainer) {
      iconContainer.style.backgroundColor = `${info.color}25`;
      iconContainer.style.borderColor = `${info.color}50`;
      iconContainer.style.color = info.color;
      iconContainer.innerHTML = `<i data-lucide="${info.icon || 'activity'}" class="w-5 h-5"></i>`;
    }

    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
          <div class="text-[11px] font-bold text-slate-400">מה זה ומה המשמעות?</div>
          <div class="text-xs text-slate-200 leading-relaxed">${info.whatIsIt}</div>
        </div>

        <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
          <div class="text-[11px] font-bold text-emerald-400">ערכי ייחוס ונורמות תקינות:</div>
          <div class="text-xs text-slate-300 leading-relaxed font-mono bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">${info.norms}</div>
        </div>

        <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
          <div class="text-[11px] font-bold text-cyan-400">השפעה בריאותית ויעדי חיטוב:</div>
          <div class="text-xs text-slate-200 leading-relaxed">${info.healthImpact}</div>
        </div>

        <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
          <div class="text-[11px] font-bold text-amber-400 flex items-center gap-1.5">
            <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
            <span>המלצות מעשיות לשיפור ושימור:</span>
          </div>
          <ul class="space-y-1.5 pr-2">
            ${info.recommendations.map(r => `
              <li class="flex items-start gap-2 text-xs text-slate-300">
                <span class="text-emerald-400 font-bold shrink-0">•</span>
                <span>${r}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    modal.classList.remove('hidden');
    refreshIcons();
  }

  closeTanitaInfoModal() {
    const modal = document.getElementById('tanita-info-modal');
    if (modal) modal.classList.add('hidden');
  }

  updateModalIfOpen() {
    const modal = document.getElementById('profile-modal');
    if (modal && !modal.classList.contains('hidden')) {
      this.populateModalFields();
      const alertBox = document.getElementById('profile-modal-alert');
      if (alertBox) alertBox.classList.add('hidden');
    }
  }

  populateModalFields() {
    const profile = state.getCurrentProfile();
    const isArik = state.activeUser === 'Arik';

    const userBadge = document.getElementById('profile-form-user-badge');
    if (userBadge) {
      userBadge.textContent = profile.hebrewName;
      userBadge.className = isArik
        ? 'font-bold text-emerald-400 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30'
        : 'font-bold text-cyan-400 px-3 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30';
    }

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };

    setVal('prof-email', profile.email || '');
    setVal('prof-height', profile.height || (isArik ? 174 : 152));
    setVal('prof-start-weight', profile.startWeight || profile.currentWeight || (isArik ? 70 : 56));
    setVal('prof-target-weight', profile.targetWeight || (isArik ? 67 : 50));
    setVal('prof-target-visceral', profile.targetVisceralFat || (isArik ? 4 : 3));
    setVal('prof-target-body-fat', profile.targetBodyFat || (isArik ? 15.0 : 20.0));
    setVal('prof-focus', profile.focus || (isArik ? 'הפחתת שומן בטני (ויסצראלי) תוך שמירה על מסת שריר' : 'חיטוב ואיזון הרכב גוף'));

    this.updateModalAutoMacroPreview();
  }

  updateModalAutoMacroPreview() {
    const profile = state.getCurrentProfile();
    const targetWInput = document.getElementById('prof-target-weight');
    const targetW = targetWInput ? Number(targetWInput.value) || profile.targetWeight : profile.targetWeight;

    const auto = calculateAutoMacros(state.activeUser, targetW, profile.measuredBmr);

    const setText = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setText('modal-auto-kcal', `${auto.targetKcal} kcal`);
    setText('modal-auto-deficit', `גירעון: -${auto.deficitKcal} kcal`);
    setText('modal-auto-protein', `${auto.targetProtein}g`);
    setText('modal-auto-carbs', `${auto.targetCarbs}g`);
    setText('modal-auto-fat', `${auto.targetFat}g`);
  }

  render() {
    try {
      this.updateProfileButtons();
      this.updateActiveNav();
      this.updateHeaderDateText();
      this.renderActiveView();
      this.bindUniversalCollapseButtons();

      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    } catch (err) {
      console.error('Error during App.render():', err);
    }
  }

  updateProfileButtons() {
    const currentProfile = state.getCurrentProfile();
    const displayNameEl = document.getElementById('header-user-display-name');
    const colorDotEl = document.getElementById('header-user-color-dot');
    const optionsListEl = document.getElementById('header-user-options-list');
    const userCountEl = document.getElementById('header-dropdown-user-count');
    const dropdownActions = document.getElementById('header-user-dropdown-actions');
    const chevronEl = document.getElementById('header-user-chevron');
    const drawerProfileBadge = document.getElementById('drawer-active-profile-badge');
    const drawerSwitcherList = document.getElementById('drawer-profile-switcher-list');

    if (displayNameEl && currentProfile) {
      displayNameEl.textContent = currentProfile.hebrewName || currentProfile.name;
    }
    if (drawerProfileBadge && currentProfile) {
      drawerProfileBadge.textContent = `${currentProfile.hebrewName || currentProfile.name} (יעד: ${currentProfile.targetWeight} ק״ג)`;
    }

    if (colorDotEl) {
      const isArik = state.activeUser === 'Arik';
      const isGranit = state.activeUser === 'Granit';
      colorDotEl.className = `w-2.5 h-2.5 rounded-full shrink-0 ${
        isArik ? 'bg-emerald-400' : isGranit ? 'bg-cyan-400' : 'bg-amber-400'
      }`;
    }

    if (chevronEl) chevronEl.classList.remove('hidden');
    if (dropdownActions) dropdownActions.classList.remove('hidden');

    const allUsers = state.getAllUserProfiles();
    if (userCountEl) userCountEl.textContent = `${allUsers.length} פרופילים`;

    const renderUserItems = () => {
      return allUsers.map(u => {
        const isActive = state.activeUser === u.name;
        const isArik = u.name === 'Arik';
        const isGranit = u.name === 'Granit';
        const dotColor = isArik ? 'bg-emerald-400' : isGranit ? 'bg-cyan-400' : 'bg-amber-400';

        return `
          <button
            type="button"
            data-user-switch="${u.name}"
            class="w-full text-right px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer min-h-[40px] select-none ${
              isActive
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black shadow-sm'
                : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
            }"
          >
            <div class="flex items-center gap-2 truncate">
              <span class="w-2.5 h-2.5 rounded-full ${dotColor} shrink-0"></span>
              <span class="truncate">${u.hebrewName || u.name}</span>
            </div>
            ${isActive ? '<i data-lucide="check" class="w-4 h-4 text-emerald-400 shrink-0"></i>' : ''}
          </button>
        `;
      }).join('');
    };

    if (optionsListEl) {
      optionsListEl.innerHTML = renderUserItems();
      optionsListEl.querySelectorAll('[data-user-switch]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const userKey = btn.getAttribute('data-user-switch');
          if (userKey) {
            state.setActiveUser(userKey);
            const p = state.getCurrentProfile();
            this.closeUserDropdown();
            this.showToast(`עברת לפרופיל ${p.hebrewName || p.name} ✓`, 'info');
            this.updateModalIfOpen();
            this.render();
          }
        });
      });
    }

    if (drawerSwitcherList) {
      drawerSwitcherList.innerHTML = renderUserItems();
      drawerSwitcherList.querySelectorAll('[data-user-switch]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const userKey = btn.getAttribute('data-user-switch');
          if (userKey) {
            state.setActiveUser(userKey);
            const p = state.getCurrentProfile();
            const drawer = document.getElementById('hamburger-drawer');
            if (drawer) drawer.classList.add('hidden');
            this.closeUserDropdown();
            this.showToast(`עברת לפרופיל ${p.hebrewName || p.name} ✓`, 'info');
            this.updateModalIfOpen();
            this.render();
          }
        });
      });
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  initUserDropdownListeners() {
    const selectBtn = document.getElementById('header-user-select-btn');
    const dropdown = document.getElementById('header-user-dropdown');
    const chevron = document.getElementById('header-user-chevron');
    const addBtn = document.getElementById('header-dropdown-add-user-btn');

    if (selectBtn && dropdown) {
      selectBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isHidden = dropdown.classList.contains('hidden');
        if (isHidden) {
          dropdown.classList.remove('hidden');
          selectBtn.setAttribute('aria-expanded', 'true');
          if (chevron) chevron.classList.add('rotate-180');
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
        } else {
          this.closeUserDropdown();
        }
      });

      dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      document.addEventListener('click', (e) => {
        const container = document.getElementById('user-selector-container');
        if (container && !container.contains(e.target)) {
          this.closeUserDropdown();
        }
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeUserDropdown();
        }
      });
    }

    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeUserDropdown();
        this.openProfileModal('create');
      });
    }
  }

  closeUserDropdown() {
    const dropdown = document.getElementById('header-user-dropdown');
    const selectBtn = document.getElementById('header-user-select-btn');
    const chevron = document.getElementById('header-user-chevron');
    if (dropdown) dropdown.classList.add('hidden');
    if (selectBtn) selectBtn.setAttribute('aria-expanded', 'false');
    if (chevron) chevron.classList.remove('rotate-180');
  }

  bindUniversalCollapseButtons() {
    document.querySelectorAll('[data-collapse-card]').forEach(btn => {
      if (btn.dataset.boundCollapse) return;
      btn.dataset.boundCollapse = 'true';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetId = btn.getAttribute('data-collapse-card');
        const detailsEl = document.getElementById(targetId);
        if (detailsEl && detailsEl.tagName === 'DETAILS') {
          detailsEl.removeAttribute('open');
          const summaryEl = detailsEl.querySelector('summary');
          if (summaryEl) {
            summaryEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      });
    });
  }

  initHamburgerMenuListeners() {
    const hamburgerBtn = document.getElementById('header-hamburger-btn');
    const drawer = document.getElementById('hamburger-drawer');
    const closeBtn = document.getElementById('close-hamburger-btn');
    const backdrop = document.getElementById('hamburger-backdrop');
    const userBadge = document.getElementById('header-user-badge');

    const openDrawer = () => {
      if (drawer) {
        drawer.classList.remove('hidden');
        this.updateDrawerUserInfo();
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          window.lucide.createIcons();
        }
      }
    };

    const closeDrawer = () => {
      if (drawer) drawer.classList.add('hidden');
    };

    if (hamburgerBtn) {
      hamburgerBtn.addEventListener('click', openDrawer);
    }
    if (userBadge) {
      userBadge.addEventListener('click', openDrawer);
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', closeDrawer);
    }
    if (backdrop) {
      backdrop.addEventListener('click', closeDrawer);
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDrawer();
      }
    });

    // Drawer action buttons
    const drawerSync = document.getElementById('drawer-cloud-sync-btn');
    if (drawerSync) {
      drawerSync.addEventListener('click', async () => {
        closeDrawer();
        this.showToast('מתחיל סנכרון מלא עם הענן...', 'info');
        await this.syncCloudDataForUser(null, true);
      });
    }

    const drawerSettings = document.getElementById('drawer-settings-btn');
    if (drawerSettings) {
      drawerSettings.addEventListener('click', () => {
        closeDrawer();
        this.openProfileModal('edit');
      });
    }

    const drawerAddUser = document.getElementById('drawer-add-user-btn');
    if (drawerAddUser) {
      drawerAddUser.addEventListener('click', () => {
        closeDrawer();
        this.openProfileModal('create');
      });
    }

    const drawerManageUsers = document.getElementById('drawer-manage-users-btn');
    if (drawerManageUsers) {
      drawerManageUsers.addEventListener('click', () => {
        closeDrawer();
        this.openProfileModal('manage');
      });
    }

    const drawerTheme = document.getElementById('drawer-theme-btn');
    if (drawerTheme) {
      drawerTheme.addEventListener('click', () => {
        closeDrawer();
        this.openThemeModal();
      });
    }

    const drawerCalendar = document.getElementById('drawer-calendar-btn');
    if (drawerCalendar) {
      drawerCalendar.addEventListener('click', () => {
        closeDrawer();
        this.openCalendarModal();
      });
    }

    const drawerWebapp = document.getElementById('drawer-webapp-link');
    if (drawerWebapp) {
      drawerWebapp.addEventListener('click', () => {
        closeDrawer();
      });
    }

    const drawerLogout = document.getElementById('drawer-logout-btn');
    if (drawerLogout) {
      drawerLogout.addEventListener('click', async () => {
        closeDrawer();
        await logOut();
        state.setAuthUser(null);
        const overlay = document.getElementById('auth-login-overlay');
        const headerAuth = document.getElementById('header-auth-user');
        if (overlay) overlay.classList.remove('hidden');
        if (headerAuth) {
          headerAuth.classList.add('hidden');
          headerAuth.classList.remove('flex');
        }
        this.showToast('התנתקת מהמערכת בהצלחה', 'info');
        this.render();
      });
    }
  }

  updateDrawerUserInfo() {
    const user = state.authUser;
    const nameEl = document.getElementById('drawer-user-name');
    const emailEl = document.getElementById('drawer-user-email');
    const avatarEl = document.getElementById('drawer-user-avatar');
    const initialsEl = document.getElementById('drawer-user-initials');
    const roleBadgeEl = document.getElementById('drawer-user-role-badge');
    const activeBadgeEl = document.getElementById('drawer-active-profile-badge');
    const addUserBtn = document.getElementById('drawer-add-user-btn');
    const manageUsersBtn = document.getElementById('drawer-manage-users-btn');
    const versionTag = document.getElementById('drawer-version-tag');
    const versionBadge = document.getElementById('drawer-app-version-badge');

    if (versionTag) {
      versionTag.textContent = `v${APP_VERSION}`;
    }
    if (versionBadge) {
      versionBadge.textContent = `v${APP_VERSION}`;
    }

    const currentProfile = state.getCurrentProfile();
    if (activeBadgeEl && currentProfile) {
      activeBadgeEl.textContent = `${currentProfile.hebrewName || currentProfile.name} (יעד: ${currentProfile.targetWeight} ק״ג)`;
    }

    if (addUserBtn) {
      addUserBtn.classList.toggle('hidden', !state.isSuperAdmin);
    }
    if (manageUsersBtn) {
      manageUsersBtn.classList.toggle('hidden', !state.isSuperAdmin);
    }

    if (!user) {
      if (nameEl) nameEl.textContent = 'אורח';
      if (emailEl) emailEl.textContent = 'לא מחובר';
      if (roleBadgeEl) roleBadgeEl.textContent = 'לא מחובר';
      return;
    }

    const email = user.email || '';
    if (nameEl) nameEl.textContent = user.displayName || email.split('@')[0] || 'משתמש מחובר';
    if (emailEl) emailEl.textContent = email;
    if (roleBadgeEl) {
      roleBadgeEl.textContent = state.isSuperAdmin ? 'Super Admin' : 'משתמש מורשה';
      roleBadgeEl.className = state.isSuperAdmin
        ? 'text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0'
        : 'text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shrink-0';
    }

    if (user.photoURL && avatarEl && initialsEl) {
      avatarEl.src = user.photoURL;
      avatarEl.classList.remove('hidden');
      initialsEl.classList.add('hidden');
    } else if (initialsEl && avatarEl) {
      const initials = (user.displayName || email || 'AG')
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
      initialsEl.textContent = initials || 'AG';
      initialsEl.classList.remove('hidden');
      avatarEl.classList.add('hidden');
    }
  }

  updateActiveNav() {
    document.querySelectorAll('.nav-tab').forEach(btn => {
      const tab = btn.getAttribute('data-tab');
      if (tab === state.activeTab) {
        btn.classList.add('text-emerald-400', 'bg-slate-800/60');
        btn.classList.remove('text-slate-400');
      } else {
        btn.classList.remove('text-emerald-400', 'bg-slate-800/60');
        btn.classList.add('text-slate-400');
      }
    });
  }

  renderActiveView() {
    const container = document.getElementById('view-dashboard');
    if (!container) return;

    try {
      switch (state.activeTab) {
        case 'dashboard':
          container.innerHTML = this.getDashboardHTML();
          this.bindDashboardEvents();
          break;
        case 'meals':
          container.innerHTML = this.getMealsHTML();
          this.bindMealsEvents();
          break;
        case 'tanita':
          container.innerHTML = this.getTanitaHTML();
          this.bindTanitaEvents();
          setTimeout(() => this.renderProgressCharts(), 60);
          break;
        case 'coach':
          container.innerHTML = this.getCoachHTML();
          this.bindCoachEvents();
          break;
        case 'settings':
          container.innerHTML = this.getSettingsHTML();
          this.bindSettingsEvents();
          break;
        default:
          container.innerHTML = this.getDashboardHTML();
          this.bindDashboardEvents();
      }
    } catch (err) {
      console.error('Error rendering active tab:', state.activeTab, err);
      container.innerHTML = `
        <div class="p-6 bg-red-950/80 border border-red-500 rounded-2xl text-center space-y-3 m-4">
          <div class="text-2xl">⚠️</div>
          <h3 class="text-base font-bold text-red-200">שגיאה בטעינת מסך ${state.activeTab}</h3>
          <p class="text-xs text-red-300 font-mono text-left dir-ltr p-3 bg-slate-950 rounded-lg overflow-x-auto">${err.stack || err.message || err}</p>
        </div>
      `;
    }
  }

  // --- 1. DYNAMIC MACRO & CALORIE PROGRESS BARS (VISUAL BUDGET & REMAINING TRACKER) ---
  getMacroBudgetProgressBarsHTML(macros, profile, isSticky = false) {
    const items = [
      {
        id: 'calories',
        name: 'קלוריות',
        fullName: 'קלוריות (Calories)',
        icon: 'zap',
        consumed: macros.kcal,
        target: profile.targetKcal,
        unit: 'kcal',
        colorClass: 'text-emerald-400',
        barGradient: 'bg-gradient-to-r from-emerald-500 to-teal-400',
        badgeBg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      },
      {
        id: 'protein',
        name: 'חלבון',
        fullName: 'חלבון (Protein)',
        icon: 'shield-check',
        consumed: macros.protein,
        target: profile.targetProtein,
        unit: 'g',
        colorClass: 'text-cyan-400',
        barGradient: 'bg-gradient-to-r from-cyan-400 to-blue-500',
        badgeBg: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
      },
      {
        id: 'carbs',
        name: 'פחמימות',
        fullName: 'פחמימות (Carbs)',
        icon: 'wheat',
        consumed: macros.carbs,
        target: profile.targetCarbs,
        unit: 'g',
        colorClass: 'text-amber-400',
        barGradient: 'bg-gradient-to-r from-amber-400 to-yellow-500',
        badgeBg: 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      },
      {
        id: 'fat',
        name: 'שומן',
        fullName: 'שומן (Fat)',
        icon: 'droplet',
        consumed: macros.fat,
        target: profile.targetFat,
        unit: 'g',
        colorClass: 'text-purple-400',
        barGradient: 'bg-gradient-to-r from-purple-500 to-fuchsia-400',
        badgeBg: 'bg-purple-500/15 text-purple-300 border-purple-500/30'
      }
    ];

    if (isSticky) {
      return `
        <div class="macro-budget-card sticky-macro-card py-2 px-2.5 sm:px-3.5 rounded-xl border border-slate-700/80 shadow-xl space-y-1.5">
          <div class="flex justify-between items-center text-[11px] pb-1 border-b border-slate-800/80">
            <div class="flex items-center gap-1.5">
              <i data-lucide="bar-chart-2" class="w-3.5 h-3.5 text-emerald-400"></i>
              <span class="font-extrabold text-slate-200">תקציב מאקרו וקלוריות</span>
            </div>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
              יעד: <strong class="text-emerald-400">${profile.targetKcal} kcal</strong>
            </span>
          </div>

          <div class="grid grid-cols-4 gap-1.5 sm:gap-2">
            ${items.map(item => {
              const isKcal = item.unit === 'kcal';
              const consumed = isKcal ? Math.round(item.consumed) : (Math.round(item.consumed * 10) / 10);
              const target = item.target;
              const pct = target > 0 ? Math.round((consumed / target) * 100) : 0;
              const isExceeded = consumed > target;
              const diff = isKcal ? Math.round(consumed - target) : (Math.round((consumed - target) * 10) / 10);
              const remaining = isKcal ? Math.max(0, Math.round(target - consumed)) : Math.max(0, Math.round((target - consumed) * 10) / 10);
              const fillWidth = Math.min(100, pct);

              return `
                <div class="bg-slate-900/90 rounded-lg p-1.5 border border-slate-800/80 flex flex-col justify-between text-center min-w-0" id="macro-sticky-${item.id}">
                  <div class="flex items-center justify-between text-[10px] leading-tight font-bold mb-0.5">
                    <span class="${item.colorClass} truncate">${item.name}</span>
                    <span class="text-[9px] text-slate-400">${pct}%</span>
                  </div>
                  <div class="text-[11px] font-black text-slate-100 leading-tight">
                    ${consumed}<span class="text-[9px] font-normal text-slate-400">/${target}</span>
                  </div>
                  <div class="w-full bg-slate-950 rounded-full h-1 my-1 overflow-hidden">
                    <div class="h-full ${isExceeded ? 'bg-red-500' : item.barGradient}" style="width: ${fillWidth}%;"></div>
                  </div>
                  <div class="text-[9px] leading-none font-bold truncate ${isExceeded ? 'text-red-400 font-black' : 'text-slate-400'}">
                    ${isExceeded ? `+${diff}` : `נשאר ${remaining}`}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    return `
      <div class="macro-budget-card dashboard-card p-3.5 sm:p-4 rounded-2xl space-y-2.5">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-800">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold shrink-0">
              <i data-lucide="bar-chart-2" class="w-3.5 h-3.5"></i>
            </div>
            <div>
              <h3 class="text-xs sm:text-sm font-extrabold text-slate-100">
                תקציב מאקרו וקלוריות יומי
              </h3>
            </div>
          </div>
          <div class="flex items-center gap-2 self-stretch sm:self-auto justify-end">
            <span class="text-[11px] sm:text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-950/80 border border-slate-800 text-slate-300">
              יעד: <strong class="text-emerald-400">${profile.targetKcal} kcal</strong>
            </span>
          </div>
        </div>

        <div class="space-y-2">
          ${items.map(item => {
            const isKcal = item.unit === 'kcal';
            const consumed = isKcal ? Math.round(item.consumed) : (Math.round(item.consumed * 10) / 10);
            const target = item.target;
            const pct = target > 0 ? Math.round((consumed / target) * 100) : 0;
            const isExceeded = consumed > target;
            const diff = isKcal ? Math.round(consumed - target) : (Math.round((consumed - target) * 10) / 10);
            const remaining = isKcal ? Math.max(0, Math.round(target - consumed)) : Math.max(0, Math.round((target - consumed) * 10) / 10);
            const fillWidth = Math.min(100, pct);

            return `
              <div class="space-y-1" id="macro-bar-${item.id}">
                <div class="flex flex-wrap items-center justify-between gap-1 text-xs">
                  <div class="flex items-center gap-1.5">
                    <span class="font-extrabold ${item.colorClass}">${item.fullName}</span>
                    <span class="text-[11px] font-bold text-slate-200 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800">
                      ${consumed} / ${target} ${item.unit} (${pct}%)
                    </span>
                  </div>
                  <div>
                    ${isExceeded ? `
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-black bg-red-500/20 text-red-300 border border-red-500/50 flex items-center gap-1 shadow-sm">
                        <span>⚠️</span>
                        <span>חריגה של ${diff} ${item.unit}</span>
                      </span>
                    ` : `
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-bold border ${item.badgeBg}">
                        נשארו: ${remaining} ${item.unit}
                      </span>
                    `}
                  </div>
                </div>
                <div class="macro-bar-track" style="height: 6px;" title="${consumed} / ${target} ${item.unit} (${pct}%)">
                  <div
                    class="macro-bar-fill ${isExceeded ? 'macro-bar-exceeded' : item.barGradient}"
                    style="width: ${fillWidth}%; height: 6px;"
                  ></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // --- 2. DAILY WORKOUT & ACTIVITY LOGGING CARD ---
  getWorkoutActivityCardHTML(user, dateStr, macros, profile) {
    const workout = getWorkoutForDate(user, dateStr);
    const burnedKcal = calculateWorkoutBurn(workout);
    const netCalories = calculateNetCalories(macros.kcal, burnedKcal);
    const isWorkedOut = Boolean(workout.workedOut);
    const stepsDistKm = estimateStepsDistanceKm(workout.steps || 0);
    const stepsCalories = estimateStepsCalories(workout.steps || 0);

    return `
      <div class="workout-card dashboard-card p-4 sm:p-5 space-y-4">
        <!-- Header -->
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-800">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold shrink-0">
              <i data-lucide="flame" class="w-5 h-5"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-sm sm:text-base font-extrabold text-slate-100">מעקב אימון ופעילות יומית</h3>
                <span id="workout-status-badge" class="text-[11px] font-bold px-2 py-0.5 rounded-full ${isWorkedOut ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-800 text-slate-400'}">
                  ${isWorkedOut ? '🔥 יום אימון פעיל' : '🧘 יום מנוחה'}
                </span>
              </div>
              <p class="text-[11px] sm:text-xs text-slate-400">רישום צעדים, שעון חכם, אימון כוח וחישוב קלוריות נטו (Net Calories)</p>
            </div>
          </div>
          <div class="flex items-center gap-2 self-stretch sm:self-auto justify-end">
            <span class="text-xs text-slate-400 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
              שריפת פעילות: <strong id="workout-total-burned-badge" class="text-amber-400 font-black">${burnedKcal} kcal</strong>
            </span>
          </div>
        </div>

        <!-- Toggle: "האם התאמנת היום?" -->
        <div class="space-y-1.5">
          <label class="block text-xs font-bold text-slate-300">האם התאמנת היום?</label>
          <div class="flex gap-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              id="workout-toggle-yes"
              class="workout-toggle-option ${isWorkedOut ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-md shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200'}"
            >
              <span>💪 כן, התאמנתי היום!</span>
            </button>
            <button
              type="button"
              id="workout-toggle-no"
              class="workout-toggle-option ${!isWorkedOut ? 'bg-slate-800 text-slate-200 font-bold border border-slate-700' : 'text-slate-400 hover:text-slate-200'}"
            >
              <span>🧘 לא, יום מנוחה והתאוששות</span>
            </button>
          </div>
        </div>

        <!-- Dynamic Fields Container -->
        <div id="workout-fields-container" class="${isWorkedOut ? 'space-y-4' : 'space-y-4'}">
          <!-- Inputs: Steps, Smartwatch calories, Strength duration -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <!-- 1. Steps Count -->
            <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
              <div class="flex justify-between items-center">
                <label class="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <i data-lucide="footprints" class="w-3.5 h-3.5 text-emerald-400"></i>
                  <span>כמות צעדים (Steps)</span>
                </label>
              </div>
              <input
                type="number"
                step="any"
                id="workout-steps"
                value="${workout.steps || ''}"
                placeholder="לדוגמה: 8500"
                class="input-field text-xs font-bold"
              />
              <div class="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                <span>מרחק משוער: <strong id="steps-dist-label" class="text-emerald-400">${stepsDistKm}</strong> ק"מ</span>
                <span>שריפה: <strong id="steps-kcal-label" class="text-cyan-400">${stepsCalories}</strong> kcal</span>
              </div>
            </div>

            <!-- 2. Smartwatch Active Burn -->
            <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
              <div class="flex justify-between items-center">
                <label class="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <i data-lucide="watch" class="w-3.5 h-3.5 text-cyan-400"></i>
                  <span>שריפה משעון חכם (Active kcal)</span>
                </label>
                <button
                  type="button"
                  id="workout-copy-steps-kcal"
                  title="השתמש בקלוריות ששרפת מצעדים"
                  class="text-[10px] text-cyan-400 hover:text-cyan-300 cursor-pointer underline"
                >
                  קלוריות ששרפת
                </button>
              </div>
              <input
                type="number"
                step="any"
                id="workout-smartwatch-kcal"
                value="${workout.smartwatchCalories || ''}"
                placeholder="Apple Watch / Garmin / Galaxy"
                class="input-field text-xs font-bold text-cyan-400"
              />
              <div class="text-[10px] text-slate-500">
                קלוריות פעילות שנמדדו בפועל בשעון חכם
              </div>
            </div>

            <!-- 3. Strength Training Duration -->
            <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
              <label class="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <i data-lucide="dumbbell" class="w-3.5 h-3.5 text-amber-400"></i>
                <span>אימון כוח (משך בדקות)</span>
              </label>
              <input
                type="number"
                step="any"
                id="workout-strength-duration"
                value="${workout.strengthDuration || ''}"
                placeholder="דקות (למשל: 45)"
                class="input-field text-xs font-bold text-amber-400"
              />
              <div class="text-[10px] text-slate-500">
                משוער: ~6 kcal לדקת אימון כוח
              </div>
            </div>
          </div>

          <!-- Targeted Muscle Groups (Interactive Chips) -->
          <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
            <label class="block text-xs font-bold text-slate-300">קבוצות שריר ממוקדות באימון:</label>
            <div class="flex flex-wrap gap-1.5" id="workout-muscle-chips-container">
              ${MUSCLE_GROUPS.map(mg => {
                const isSelected = workout.strengthMuscles.includes(mg.id) || workout.strengthMuscles.includes(mg.label);
                return `
                  <button
                    type="button"
                    data-muscle-id="${mg.id}"
                    data-muscle-label="${mg.label}"
                    class="muscle-chip ${isSelected ? 'selected' : ''}"
                  >
                    ${isSelected ? '✓ ' : ''}${mg.label}
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Workout Notes -->
          <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
            <label class="block text-xs font-bold text-slate-300">הערות לאימון / תחושה כללית:</label>
            <input
              type="text"
              id="workout-notes"
              value="${workout.notes || ''}"
              placeholder="לדוגמה: אימון משקולות מעולה, דגש סקוואט ולחיצות חזה, הרגשה חזקה..."
              class="input-field text-xs"
            />
          </div>

          <!-- Net Calories Calculation & Deficit Guidance -->
          <div class="bg-gradient-to-br from-slate-950 to-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <span class="text-xs font-black text-slate-200 flex items-center gap-1.5">
                <i data-lucide="calculator" class="w-4 h-4 text-emerald-400"></i>
                <span>מאזן קלוריות נטו (Net Calories = Food - Workout)</span>
              </span>
              <span id="net-cal-budget-status" class="text-xs font-bold px-2.5 py-0.5 rounded-full ${netCalories <= profile.targetKcal ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-red-500/20 text-red-300 border border-red-500/40'}">
                ${netCalories <= profile.targetKcal ? '✅ בתקציב היעד' : '⚠️ מעל תקציב היעד'}
              </span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div class="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div class="text-[10px] text-slate-400">מזון שנאכל</div>
                <div class="text-base font-black text-slate-100" id="net-card-food">${macros.kcal} <span class="text-[10px] font-normal text-slate-400">kcal</span></div>
              </div>
              <div class="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div class="text-[10px] text-slate-400">שריפת פעילות</div>
                <div class="text-base font-black text-amber-400" id="net-card-burned">-${burnedKcal} <span class="text-[10px] font-normal text-slate-400">kcal</span></div>
              </div>
              <div class="bg-emerald-950/50 p-2.5 rounded-lg border border-emerald-500/30">
                <div class="text-[10px] text-emerald-400 font-bold">קלוריות נטו (Net)</div>
                <div class="text-base font-black text-emerald-300" id="live-net-calories-val">${netCalories} <span class="text-[10px] font-normal text-emerald-400">kcal</span></div>
              </div>
              <div class="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div class="text-[10px] text-slate-400">יעד תזונתי קבוע</div>
                <div class="text-base font-black text-cyan-400">${profile.targetKcal} <span class="text-[10px] font-normal text-slate-400">kcal</span></div>
              </div>
            </div>

            <!-- Scientific Deficit Guidance -->
            <div class="text-[11px] text-slate-300 leading-relaxed bg-slate-950/80 p-3 rounded-lg border border-slate-800">
              💡 <strong>הבחנה חשובה בין גירעון תזונתי לשריפת אימון:</strong><br />
              יעד האכילה של ${profile.hebrewName} (${profile.targetKcal} kcal) כבר מבוסס על גירעון מובנה לשריפת שומן ויסצראלי.
              שריפת האימון והצעדים (${burnedKcal} kcal) מעמיקה את הגירעון הבריאותי — מומלץ <em>לא "לאכול בחזרה"</em> את הקלוריות שנשרפו, כדי לשמור על קצב חיטוב עקבי.
            </div>
          </div>

          <!-- Actions & Save -->
          <div class="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              id="btn-save-workout"
              class="btn-primary text-xs flex items-center gap-1.5 cursor-pointer font-bold px-4 py-2"
            >
              <i data-lucide="check" class="w-3.5 h-3.5"></i>
              <span>שמור נתוני אימון ליומן</span>
            </button>
            <div id="workout-save-indicator" class="text-xs font-bold text-emerald-400 hidden">✓ נשמר ליומן</div>
          </div>
        </div>
      </div>
    `;
  }

  bindWorkoutEvents() {
    const user = state.activeUser;
    const dateStr = state.selectedDate;
    let workout = getWorkoutForDate(user, dateStr);
    const profile = state.getCurrentProfile();
    const meals = getMealsForDate(user, dateStr);
    const macros = calculateDailyMacros(meals);

    const toggleYes = document.getElementById('workout-toggle-yes');
    const toggleNo = document.getElementById('workout-toggle-no');
    const stepsInput = document.getElementById('workout-steps');
    const smartwatchInput = document.getElementById('workout-smartwatch-kcal');
    const strengthInput = document.getElementById('workout-strength-duration');
    const notesInput = document.getElementById('workout-notes');
    const copyStepsBtn = document.getElementById('workout-copy-steps-kcal');
    const saveBtn = document.getElementById('btn-save-workout');
    const saveIndicator = document.getElementById('workout-save-indicator');

    const updateLiveCalculations = () => {
      const steps = Math.max(0, parseInt(stepsInput?.value, 10) || 0);
      const distKm = estimateStepsDistanceKm(steps);
      const stepsKcal = estimateStepsCalories(steps);

      const distLabel = document.getElementById('steps-dist-label');
      const kcalLabel = document.getElementById('steps-kcal-label');
      if (distLabel) distLabel.textContent = distKm;
      if (kcalLabel) kcalLabel.textContent = stepsKcal;

      const swVal = parseInt(smartwatchInput?.value, 10);
      const strVal = parseInt(strengthInput?.value, 10) || 0;

      let burned = 0;
      if (!isNaN(swVal) && swVal > 0) {
        burned = swVal;
      } else {
        burned = stepsKcal + Math.round(strVal * 6);
      }

      const burnedBadge = document.getElementById('workout-total-burned-badge');
      if (burnedBadge) burnedBadge.textContent = `${burned} kcal`;

      const netBurnedCard = document.getElementById('net-card-burned');
      if (netBurnedCard) netBurnedCard.innerHTML = `-${burned} <span class="text-[10px] font-normal text-slate-400">kcal</span>`;

      const net = macros.kcal - burned;
      const liveNetVal = document.getElementById('live-net-calories-val');
      if (liveNetVal) liveNetVal.innerHTML = `${net} <span class="text-[10px] font-normal text-emerald-400">kcal</span>`;

      const statusBadge = document.getElementById('net-cal-budget-status');
      if (statusBadge) {
        if (net <= profile.targetKcal) {
          statusBadge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
          statusBadge.textContent = '✅ בתקציב היעד';
        } else {
          statusBadge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40';
          statusBadge.textContent = '⚠️ מעל תקציב היעד';
        }
      }
    };

    const persistWorkout = (silent = true) => {
      const selectedMuscles = [];
      document.querySelectorAll('#workout-muscle-chips-container .muscle-chip.selected').forEach(c => {
        selectedMuscles.push(c.getAttribute('data-muscle-label') || c.getAttribute('data-muscle-id'));
      });

      const updated = {
        workedOut: workout.workedOut,
        steps: Math.max(0, parseInt(stepsInput?.value, 10) || 0),
        smartwatchCalories: Math.max(0, parseInt(smartwatchInput?.value, 10) || 0),
        strengthDuration: Math.max(0, parseInt(strengthInput?.value, 10) || 0),
        strengthMuscles: selectedMuscles,
        notes: (notesInput?.value || '').trim()
      };

      workout = saveWorkoutForDate(user, dateStr, updated);
      updateLiveCalculations();

      // Cloud Sync to Firestore: users/{userEmail}/daily_logs/{dateStr}
      try {
        const userEmail = state.getUserEmailKey();
        if (userEmail) {
          const meals = getMealsForDate(user, dateStr);
          syncDailyLogToCloud(userEmail, dateStr, {
            workout: updated,
            meals,
            totalMacros: calculateDailyMacros(meals)
          }).catch(err => console.warn('Firestore workout sync warning:', err));
        }
      } catch (err) {
        console.warn('Workout sync error:', err);
      }

      if (!silent) {
        this.showToast('נתוני האימון והפעילות נשמרו בהצלחה! ✓');
        this.render();
      } else if (saveIndicator) {
        saveIndicator.classList.remove('hidden');
        setTimeout(() => saveIndicator.classList.add('hidden'), 2000);
      }
    };

    if (toggleYes) {
      toggleYes.addEventListener('click', () => {
        workout.workedOut = true;
        toggleYes.className = 'workout-toggle-option bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-md shadow-amber-500/20';
        toggleNo.className = 'workout-toggle-option text-slate-400 hover:text-slate-200';
        const statusBadge = document.getElementById('workout-status-badge');
        if (statusBadge) {
          statusBadge.className = 'text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40';
          statusBadge.textContent = '🔥 יום אימון פעיל';
        }
        persistWorkout(false);
      });
    }

    if (toggleNo) {
      toggleNo.addEventListener('click', () => {
        workout.workedOut = false;
        toggleNo.className = 'workout-toggle-option bg-slate-800 text-slate-200 font-bold border border-slate-700';
        toggleYes.className = 'workout-toggle-option text-slate-400 hover:text-slate-200';
        const statusBadge = document.getElementById('workout-status-badge');
        if (statusBadge) {
          statusBadge.className = 'text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400';
          statusBadge.textContent = '🧘 יום מנוחה';
        }
        persistWorkout(false);
      });
    }

    if (stepsInput) {
      stepsInput.addEventListener('input', updateLiveCalculations);
      stepsInput.addEventListener('change', () => persistWorkout(true));
    }

    if (smartwatchInput) {
      smartwatchInput.addEventListener('input', updateLiveCalculations);
      smartwatchInput.addEventListener('change', () => persistWorkout(true));
    }

    if (strengthInput) {
      strengthInput.addEventListener('input', updateLiveCalculations);
      strengthInput.addEventListener('change', () => persistWorkout(true));
    }

    if (notesInput) {
      notesInput.addEventListener('change', () => persistWorkout(true));
    }

    if (copyStepsBtn) {
      copyStepsBtn.addEventListener('click', () => {
        const steps = Math.max(0, parseInt(stepsInput?.value, 10) || 0);
        const stepsKcal = estimateStepsCalories(steps);
        if (smartwatchInput) {
          smartwatchInput.value = stepsKcal;
          updateLiveCalculations();
          persistWorkout(true);
          this.showToast(`קלוריות ששרפת מצעדים (${stepsKcal} kcal) הועתקו לשעון`);
        }
      });
    }

    document.querySelectorAll('#workout-muscle-chips-container .muscle-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const isSel = btn.classList.contains('selected');
        const label = btn.getAttribute('data-muscle-label') || '';
        if (isSel) {
          btn.classList.remove('selected');
          btn.textContent = label;
        } else {
          btn.classList.add('selected');
          btn.textContent = `✓ ${label}`;
        }
        persistWorkout(true);
      });
    });

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        persistWorkout(false);
      });
    }
  }

  // --- DASHBOARD VIEW ---
  getDashboardHTML() {
    const user = state.activeUser;
    const profile = state.getCurrentProfile();
    const dateStr = state.selectedDate;
    const meals = getMealsForDate(user, dateStr);
    const macros = calculateDailyMacros(meals);
    const latestTanita = getLatestTanitaEntry(user);

    const kcalPct = Math.min(100, Math.round((macros.kcal / (profile.targetKcal || 1)) * 100));
    const proteinPct = Math.min(100, Math.round((macros.protein / (profile.targetProtein || 1)) * 100));
    const carbsPct = Math.min(100, Math.round((macros.carbs / (profile.targetCarbs || 1)) * 100));
    const fatPct = Math.min(100, Math.round((macros.fat / (profile.targetFat || 1)) * 100));

    const isArik = user === 'Arik';
    const isGranit = user === 'Granit';

    const cloudSyncBannerHTML = state.authUser ? `
        <!-- Cloud Sync Bar -->
        <div class="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs shadow-sm">
          <div class="flex items-center gap-2 overflow-hidden">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0 shadow-sm shadow-emerald-400/50"></span>
            <span class="text-slate-300 font-medium truncate">ענן מחובר ומסונכרן: <strong class="text-emerald-400 font-mono">${state.authUser.email}</strong></span>
            <span class="text-[10px] text-slate-500 hidden sm:inline">• גיבוי וסנכרון מיידי בין טלפון למחשב</span>
          </div>
          <button id="btn-dashboard-sync-now" type="button" class="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 active:scale-95">
            <i data-lucide="cloud-sync" class="w-3.5 h-3.5"></i>
            <span>סנכרן עכשיו עם הענן</span>
          </button>
        </div>
    ` : `
        <!-- Not Connected to Cloud Alert -->
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs shadow-sm">
          <div class="flex items-center gap-2">
            <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-400 shrink-0"></i>
            <span><strong>שים לב: אינך מחובר לחשבון Google.</strong> הרישומים נשמרים כרגע רק בזיכרון המכשיר הזה ולא עולים לענן.</span>
          </div>
          <button id="btn-dashboard-login-now" type="button" class="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-md shrink-0 active:scale-95">
            <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
            <span>התחבר עכשיו לחשבון Google</span>
          </button>
        </div>
    `;

    return `
      <div class="space-y-6">
        ${cloudSyncBannerHTML}

        <!-- Top Status Card -->
        <div class="dashboard-card bg-gradient-to-r from-slate-900/90 to-slate-800/90 border-slate-700/80">
          <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${isArik ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'}">
                  פרופיל פעיל: ${profile.hebrewName}
                </span>
                <span class="text-xs text-slate-400">גובה: <strong class="text-slate-200">${profile.height} ס"מ</strong></span>
                <span class="text-xs text-slate-500">•</span>
                <span class="text-xs text-slate-400">התחלתי: <strong class="text-slate-200">${profile.startWeight || profile.currentWeight || 70} ק"ג</strong></span>
                <span class="text-xs text-slate-500">•</span>
                <span class="text-xs text-slate-400">יעד: <strong class="text-emerald-400">${profile.targetWeight} ק"ג</strong></span>
              </div>
              <h2 class="text-xl md:text-2xl font-black text-slate-100">${profile.focus}</h2>
              <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-slate-400">
                <span class="px-2 py-0.5 rounded-md bg-slate-950/80 border border-slate-800 text-slate-300">
                  ⚡ BMR טניטה: <strong>${profile.measuredBmr || (isArik ? 1650 : 1250)} kcal</strong>
                </span>
                <span class="px-2 py-0.5 rounded-md bg-slate-950/80 border border-slate-800 text-slate-300">
                  🔥 תחזוקה (TDEE × 1.35): <strong>${profile.maintenanceTdee || 2228} kcal</strong>
                </span>
                <span class="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold">
                  🎯 יעד מחושב: <strong>${profile.targetKcal} kcal</strong> (גירעון -${profile.deficitKcal || 678})
                </span>
              </div>
            </div>
            <div class="flex items-center gap-1.5 self-stretch md:self-auto justify-between md:justify-end">
              <div class="flex items-center gap-1 bg-slate-950/70 p-1 rounded-xl border border-slate-800">
                <button id="dash-date-prev" type="button" aria-label="יום קודם" title="יום קודם (-1)" class="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer">
                  <i data-lucide="chevron-right" class="w-4 h-4"></i>
                </button>
                <div class="flex items-center gap-1.5 px-2 py-1">
                  <i data-lucide="calendar" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>
                  <input type="date" id="dash-date-picker" value="${dateStr}" class="bg-transparent text-slate-100 text-xs font-bold focus:outline-none cursor-pointer w-auto" />
                </div>
                <button id="dash-date-next" type="button" aria-label="יום הבא" title="יום הבא (+1)" class="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer">
                  <i data-lucide="chevron-left" class="w-4 h-4"></i>
                </button>
                <button id="dash-date-today" type="button" class="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer">
                  היום
                </button>
              </div>
              <button id="quick-edit-profile-btn" aria-label="ערוך משקל ויעדים" title="ערוך משקל ויעדים" class="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3 min-h-[38px] cursor-pointer">
                <i data-lucide="edit-3" class="w-3.5 h-3.5 text-emerald-400"></i>
                <span class="hidden sm:inline">ערוך יעדים</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 7-Day Interactive Tracking Strip -->
        ${this.getCalendarStripHTML()}

        <!-- 1. Dynamic Macro & Calorie Horizontal Progress Bars (Visual Budget & Remaining Tracker) -->
        ${this.getMacroBudgetProgressBarsHTML(macros, profile)}

        <!-- 2. Daily Workout & Activity Logging Module ("האם התאמנת היום?") -->
        ${this.getWorkoutActivityCardHTML(user, dateStr, macros, profile)}



        <!-- 3. High-Level Summary & Quick Navigation Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Latest Tanita 11-Metric Summary Card (Span 2 cols on desktop) -->
          <div class="dashboard-card space-y-3.5 lg:col-span-2">
            <div class="flex justify-between items-center pb-2 border-b border-slate-800">
              <h3 class="font-bold text-slate-100 flex items-center gap-2">
                <i data-lucide="scale" class="w-4 h-4 text-emerald-400"></i>
                <span>מדד טניטה אחרון מול יעדים</span>
              </h3>
              <button id="go-to-tanita" class="btn-secondary text-xs py-1 px-3 flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer">
                <span>לטאב טניטה המלא</span>
                <i data-lucide="arrow-left" class="w-3.5 h-3.5"></i>
              </button>
            </div>
            ${latestTanita ? `
              <div class="flex justify-between items-center text-xs text-slate-400 pb-1.5 border-b border-slate-800/80">
                <span>תאריך מדידה: <strong class="text-slate-200">${latestTanita.date}</strong></span>
                <button data-dash-delete-tanita="${latestTanita.id}" class="text-[11px] text-red-400/90 hover:text-red-300 flex items-center gap-1 cursor-pointer transition-colors" title="מחק מדידה זו">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  <span>מחק מדידה</span>
                </button>
              </div>

              <!-- 11 Tanita Metrics Grid -->
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <!-- 1. Weight -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <div class="text-[10px] text-slate-400">1. משקל (יעד: ${profile.targetWeight} ק"ג)</div>
                  <div class="text-base font-extrabold text-slate-100">${latestTanita.weight} <span class="text-[10px] font-normal text-slate-400">ק"ג</span></div>
                </div>

                <!-- 2. BMI -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <div class="text-[10px] text-slate-400">2. מדד BMI</div>
                  <div class="text-base font-extrabold text-slate-200">${latestTanita.bmi || '-'} <span class="text-[10px] font-normal text-slate-400">bmi</span></div>
                </div>

                <!-- 3. Body Fat -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <div class="text-[10px] text-slate-400">3. אחוז שומן (יעד: ${profile.targetBodyFat}%)</div>
                  <div class="text-base font-extrabold text-emerald-400">${latestTanita.bodyFat}%</div>
                </div>

                <!-- 4. Muscle Mass -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <div class="text-[10px] text-slate-400">4. מסת שריר</div>
                  <div class="text-base font-extrabold text-blue-400">${latestTanita.muscleKg} <span class="text-[10px] font-normal text-slate-400">ק"ג</span></div>
                </div>

                <!-- 5. Visceral Fat (⭐ Highlighted) -->
                <div class="bg-slate-950/70 p-2.5 rounded-xl border border-amber-500/50 relative overflow-hidden bg-gradient-to-br from-amber-500/10 to-transparent">
                  <div class="text-[10px] text-amber-300 font-semibold flex items-center justify-between">
                    <span>9. שומן ויסצראלי ⭐</span>
                    <span class="text-[9px] text-slate-400">יעד: ≤${profile.targetVisceralFat}</span>
                  </div>
                  <div class="text-lg font-black text-amber-400 mt-0.5">${latestTanita.visceralFat}</div>
                </div>

                <!-- 6. Bone Mass -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <div class="text-[10px] text-slate-400">5. מסת עצם</div>
                  <div class="text-base font-extrabold text-slate-300">${latestTanita.boneMass ? latestTanita.boneMass + ' ק"ג' : '-'}</div>
                </div>

                <!-- 7. BMR -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <div class="text-[10px] text-slate-400">6. BMR חילוף חומרים</div>
                  <div class="text-base font-extrabold text-cyan-400">${latestTanita.bmr || profile.measuredBmr} <span class="text-[10px] font-normal text-slate-400">kcal</span></div>
                </div>

                <!-- 8. Body Water -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <div class="text-[10px] text-slate-400">7. נוזלים בגוף</div>
                  <div class="text-base font-extrabold text-sky-300">${latestTanita.waterPct ? latestTanita.waterPct + '%' : '-'}</div>
                </div>

                <!-- 9. Metabolic Age -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <div class="text-[10px] text-slate-400">8. גיל מטבולי</div>
                  <div class="text-base font-extrabold text-purple-300">${latestTanita.metabolicAge ? latestTanita.metabolicAge + ' שנים' : '-'}</div>
                </div>

                <!-- 10. Muscle Quality -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <div class="text-[10px] text-slate-400">10. איכות שריר</div>
                  <div class="text-base font-extrabold text-indigo-300">${latestTanita.muscleQuality ? latestTanita.muscleQuality + ' mq' : '-'}</div>
                </div>

                <!-- 11. Body Type -->
                <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 sm:col-span-2">
                  <div class="text-[10px] text-slate-400">11. מבנה גוף (Physique)</div>
                  <div class="text-xs font-bold text-emerald-300 mt-1">${latestTanita.bodyType ? (latestTanita.bodyType + ' - ' + (BODY_TYPE_LABELS[latestTanita.bodyType] || '')) : '-'}</div>
                </div>
              </div>
            ` : `
              <div class="text-center py-6 text-slate-400 text-xs space-y-2">
                <div>אין עדיין מדידות טניטה בהיסטוריה.</div>
                <button id="dash-empty-go-tanita" class="text-xs text-emerald-400 hover:underline font-bold cursor-pointer">
                  עבור לטאב טניטה להזנת שקילה ראשונה ⚡
                </button>
              </div>
            `}
          </div>

          <!-- Quick Navigation & Today's Summary Card -->
          <div class="dashboard-card space-y-4 flex flex-col justify-between">
            <div class="space-y-3">
              <div class="flex items-center gap-2 pb-2 border-b border-slate-800">
                <div class="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
                  <i data-lucide="utensils" class="w-4 h-4"></i>
                </div>
                <div>
                  <h4 class="text-sm font-bold text-slate-100">יומן תזונה יומי</h4>
                  <p class="text-[11px] text-slate-400">${getMealsForDate(user, dateStr).length} ארוחות ושייקים רשומים להיום</p>
                </div>
              </div>

              <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-1.5">
                <div class="flex justify-between text-xs">
                  <span class="text-slate-400">צריכה עד כה:</span>
                  <span class="font-extrabold text-slate-100">${macros.kcal} / ${profile.targetKcal} kcal</span>
                </div>
                <div class="flex justify-between text-xs">
                  <span class="text-slate-400">חלבון שנצרך:</span>
                  <span class="font-extrabold text-blue-400">${macros.protein}g / ${profile.targetProtein}g</span>
                </div>
                <div class="flex justify-between text-xs">
                  <span class="text-slate-400">מאזן קלורי:</span>
                  <span class="font-extrabold ${macros.kcal <= profile.targetKcal ? 'text-emerald-400' : 'text-red-400'}">
                    ${profile.targetKcal - macros.kcal >= 0 ? `נותרו עוד ${profile.targetKcal - macros.kcal} kcal` : `חריגה של ${macros.kcal - profile.targetKcal} kcal`}
                  </span>
                </div>
              </div>

              <p class="text-xs text-slate-400 leading-relaxed">
                לרישום שייקים (בוקר, ערב, אימון), מנות מהירות או הוספת ארוחה מותאמת — עבור לטאב תזונה.
              </p>
            </div>

            <div class="space-y-2 pt-2">
              <button id="dash-btn-open-meals-tab" class="btn-primary w-full py-2.5 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md">
                <i data-lucide="plus-circle" class="w-4 h-4"></i>
                <span>לרישום שייקים וארוחות בטאב תזונה ↗</span>
              </button>
              <button id="dash-btn-open-tanita-tab" class="btn-secondary w-full py-2 text-xs flex items-center justify-center gap-2 cursor-pointer">
                <i data-lucide="scale" class="w-3.5 h-3.5 text-emerald-400"></i>
                <span>הזנת מדידת טניטה / Smart Paste ↗</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Scroll Clearance Spacer -->
        <div class="h-20 sm:h-24 w-full shrink-0"></div>
      </div>
    `;
  }

  bindDashboardEvents() {
    const dashSyncBtn = document.getElementById('btn-dashboard-sync-now');
    if (dashSyncBtn) {
      dashSyncBtn.addEventListener('click', async () => {
        dashSyncBtn.disabled = true;
        const icon = dashSyncBtn.querySelector('i');
        if (icon) icon.classList.add('animate-spin');
        this.showToast('מתחיל סנכרון מלא עם הענן...', 'info');
        await this.syncCloudDataForUser(null, true);
        dashSyncBtn.disabled = false;
        if (icon) icon.classList.remove('animate-spin');
      });
    }

    const dashLoginBtn = document.getElementById('btn-dashboard-login-now');
    if (dashLoginBtn) {
      dashLoginBtn.addEventListener('click', () => {
        const overlay = document.getElementById('auth-login-overlay');
        if (overlay) overlay.classList.remove('hidden');
      });
    }

    const datePicker = document.getElementById('dash-date-picker');
    if (datePicker) {
      datePicker.addEventListener('change', (e) => {
        state.setSelectedDate(e.target.value);
      });
    }

    // Previous / Next day chevron steppers and Today button
    const prevDayBtn = document.getElementById('dash-date-prev');
    if (prevDayBtn) {
      prevDayBtn.addEventListener('click', () => {
        this.changeDateByDays(-1);
      });
    }

    const nextDayBtn = document.getElementById('dash-date-next');
    if (nextDayBtn) {
      nextDayBtn.addEventListener('click', () => {
        this.changeDateByDays(1);
      });
    }

    const todayBtn = document.getElementById('dash-date-today');
    if (todayBtn) {
      todayBtn.addEventListener('click', () => {
        const todayStr = new Date().toISOString().split('T')[0];
        state.setSelectedDate(todayStr);
        this.showToast('עברת לתאריך היום');
      });
    }

    // 7-Day Calendar Strip Events
    document.querySelectorAll('[data-strip-date]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const dStr = e.currentTarget.getAttribute('data-strip-date');
        state.setSelectedDate(dStr);
      });
    });

    const stripCalBtn = document.getElementById('strip-open-calendar-btn');
    if (stripCalBtn) {
      stripCalBtn.addEventListener('click', () => this.openCalendarModal());
    }

    const stripPrevWeekBtn = document.getElementById('strip-prev-week-btn');
    if (stripPrevWeekBtn) {
      stripPrevWeekBtn.addEventListener('click', () => {
        this.changeDateByDays(-7);
      });
    }

    const stripNextWeekBtn = document.getElementById('strip-next-week-btn');
    if (stripNextWeekBtn) {
      stripNextWeekBtn.addEventListener('click', () => {
        this.changeDateByDays(7);
      });
    }

    const stripTodayBtn = document.getElementById('strip-today-btn');
    if (stripTodayBtn) {
      stripTodayBtn.addEventListener('click', () => {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        state.setSelectedDate(todayStr);
        this.showToast('עברת לתאריך היום');
      });
    }

    // Quick Navigation buttons
    const openMealsBtn = document.getElementById('dash-btn-open-meals-tab');
    if (openMealsBtn) {
      openMealsBtn.addEventListener('click', () => state.setActiveTab('meals'));
    }

    const openTanitaBtn = document.getElementById('dash-btn-open-tanita-tab');
    if (openTanitaBtn) {
      openTanitaBtn.addEventListener('click', () => state.setActiveTab('tanita'));
    }

    const goToTanita = document.getElementById('go-to-tanita');
    if (goToTanita) {
      goToTanita.addEventListener('click', () => state.setActiveTab('tanita'));
    }

    const emptyGoTanita = document.getElementById('dash-empty-go-tanita');
    if (emptyGoTanita) {
      emptyGoTanita.addEventListener('click', () => state.setActiveTab('tanita'));
    }

    document.querySelectorAll('[data-dash-delete-tanita]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.currentTarget.getAttribute('data-dash-delete-tanita');
        if (id) {
          deleteTanitaEntry(state.activeUser, id);
          this.showToast('מדידת הטניטה נמחקה בהצלחה! ✓', 'info');
          this.render();
        }
      });
    });

    const quickEditProfile = document.getElementById('quick-edit-profile-btn');
    if (quickEditProfile) {
      quickEditProfile.addEventListener('click', () => this.openProfileModal());
    }

    const openSettingsFromDash = document.getElementById('open-settings-from-dash-btn');
    if (openSettingsFromDash) {
      openSettingsFromDash.addEventListener('click', () => state.setActiveTab('settings'));
    }

    this.bindWorkoutEvents();
  }

  // --- MEALS VIEW WITH 4 MODULAR REORDERABLE CARDS ---
  renderCardReadyMeals(isFirst, isLast) {
    return `
      <details id="meals-ready-meals-acc" data-card-id="ready_meals" class="reorderable-card accordion-card dashboard-card group border-emerald-500/20" ${this.isAccordionOpen('meals_ready_meals', true) ? 'open' : ''}>
        <summary class="cursor-pointer list-none flex items-center justify-between select-none pb-2 border-b border-slate-800/80 w-full overflow-hidden">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="card-reorder-vertical-group" onclick="event.stopPropagation()">
              <button type="button" data-move-card-up="ready_meals" class="card-reorder-btn" title="הזז למעלה" ${isFirst ? 'disabled' : ''} aria-label="הזז למעלה">
                <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
              </button>
              <div class="card-drag-handle" title="גרור לשינוי סדר כרטיסים" draggable="true" aria-label="ידית גרירה לשינוי סדר">
                <i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i>
              </div>
              <button type="button" data-move-card-down="ready_meals" class="card-reorder-btn" title="הזז למטה" ${isLast ? 'disabled' : ''} aria-label="הזז למטה">
                <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
              </button>
            </div>
            <div class="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <i data-lucide="utensils" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm font-black text-slate-100 truncate">כריכים ומנות מוכנות בלחיצה אחת</h3>
                <span class="card-count-badge shrink-0">${QUICK_PRESETS.length} מנות</span>
              </div>
              <p class="text-[11px] text-slate-400 truncate">כריכים מאוזנים ומנות עתירות חלבון עם ערכים מדויקים</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0 pr-2">
            <div class="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 text-xs font-bold text-slate-300 hover:text-emerald-300 flex items-center gap-1.5 transition-all shadow-sm shrink-0 min-h-[36px] whitespace-nowrap">
              <span class="hidden xs:inline sm:inline">כיווץ / הרחבה</span>
              <i data-lucide="chevron-down" class="w-4 h-4 text-emerald-400 transition-transform duration-200 accordion-chevron"></i>
            </div>
          </div>
        </summary>
        <div class="pt-3.5">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            ${QUICK_PRESETS.map((preset, idx) => {
              let btnId = preset.id ? `btn-preset-${preset.id}` : `preset-btn-${idx}`;
              if (preset.id === 'smoked_salmon_100g') btnId = 'btn-preset-smoked-salmon';
              else if (preset.id === 'pita_angel_118g') btnId = 'btn-preset-pita-angel';
              else if (preset.id === 'toblerone_white_8g') btnId = 'btn-preset-toblerone-white';
              else if (preset.id === 'toblerone_milk_nuts_8g') btnId = 'btn-preset-toblerone-milk-nuts';
              else if (preset.id === 'peanuts_30g') btnId = 'btn-preset-peanuts';
              else if (preset.id === 'olive_oil_tsp') btnId = 'btn-preset-olive-oil-tsp';
              return `
              <div class="food-card bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col justify-between gap-2.5 shadow-sm hover:border-emerald-500/40 transition-all">
                <div class="flex items-start gap-2.5">
                  <div class="food-thumbnail-container w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-slate-700/60 bg-slate-900/90 overflow-hidden shrink-0 flex items-center justify-center">
                    ${isValidImageUrl(preset.image) ? `
                      <img
                        src="${preset.image}"
                        alt="${preset.name}"
                        class="food-thumbnail-img w-full h-full object-cover"
                        loading="lazy"
                        onerror="this.remove(); const fb = this.parentElement?.querySelector('.food-thumbnail-fallback'); if(fb) fb.classList.remove('hidden');"
                      />
                      <span class="hidden food-thumbnail-fallback text-2xl select-none">${preset.icon || '🍽️'}</span>
                    ` : `
                      <span class="food-thumbnail-fallback text-2xl select-none">${preset.icon || '🍽️'}</span>
                    `}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-start justify-between gap-1 mb-1">
                      <span class="font-bold text-xs text-slate-100 truncate" title="${preset.name}">${preset.name}</span>
                      ${preset.badge ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0 whitespace-nowrap">${preset.badge}</span>` : ''}
                    </div>
                    <div class="food-macro-pills flex flex-wrap gap-1 text-[10.5px]">
                      <span class="food-macro-pill text-emerald-400 font-bold">${preset.kcal} kcal</span>
                      <span class="food-macro-pill text-blue-300 font-medium">חלבון: <strong class="text-blue-200">${preset.protein}g</strong></span>
                      <span class="food-macro-pill text-amber-300 font-medium">פח': ${preset.carbs}g</span>
                      <span class="food-macro-pill text-purple-300 font-medium">שומן: ${preset.fat}g</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  id="${btnId}"
                  data-preset-idx="${idx}"
                  data-preset-id="${preset.id || ''}"
                  data-preset-name="${preset.name}"
                  class="quick-preset-btn w-full py-2 px-3 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer transition-all bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-slate-950 border border-emerald-500/40 min-h-[44px]"
                >
                  <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
                  <span>רשום מנה ליומן</span>
                </button>
              </div>
            `;}).join('')}
          </div>

          <!-- Bottom Collapse Button -->
          <div class="pt-3.5 mt-3 border-t border-slate-800/80 flex justify-center">
            <button
              type="button"
              data-collapse-card="meals-ready-meals-acc"
              class="px-5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700/70 text-xs font-bold text-slate-300 hover:text-emerald-300 flex items-center gap-2 transition-all cursor-pointer shadow-sm min-h-[38px] active:scale-95"
            >
              <i data-lucide="chevron-up" class="w-4 h-4 text-emerald-400"></i>
              <span>כווץ כרטיס מנות מוכנות ▲</span>
            </button>
          </div>
        </div>
      </details>
    `;
  }

  renderCardSingleItems(isFirst, isLast) {
    return `
      <details id="meals-single-items-acc" data-card-id="single_items" class="reorderable-card accordion-card dashboard-card group border-teal-500/20" ${this.isAccordionOpen('meals_single_items', true) ? 'open' : ''}>
        <summary class="cursor-pointer list-none flex items-center justify-between select-none pb-2 border-b border-slate-800/80 w-full overflow-hidden">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="card-reorder-vertical-group" onclick="event.stopPropagation()">
              <button type="button" data-move-card-up="single_items" class="card-reorder-btn" title="הזז למעלה" ${isFirst ? 'disabled' : ''} aria-label="הזז למעלה">
                <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
              </button>
              <div class="card-drag-handle" title="גרור לשינוי סדר כרטיסים" draggable="true" aria-label="ידית גרירה לשינוי סדר">
                <i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i>
              </div>
              <button type="button" data-move-card-down="single_items" class="card-reorder-btn" title="הזז למטה" ${isLast ? 'disabled' : ''} aria-label="הזז למטה">
                <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
              </button>
            </div>
            <div class="w-8 h-8 rounded-lg bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400 shrink-0">
              <i data-lucide="layers" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm font-black text-slate-100 truncate">רכיבים בודדים עם בורר כמויות</h3>
                <span class="card-count-badge shrink-0">${SINGLE_ITEM_BUILDING_BLOCKS.length} רכיבים</span>
              </div>
              <p class="text-[11px] text-slate-400 truncate">התאמה וכיול מדויקים לפי פרוסות, כפות וגביעים (+ / -)</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0 pr-2">
            <div class="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 text-xs font-bold text-slate-300 hover:text-teal-300 flex items-center gap-1.5 transition-all shadow-sm shrink-0 min-h-[36px] whitespace-nowrap">
              <span class="hidden xs:inline sm:inline">כיווץ / הרחבה</span>
              <i data-lucide="chevron-down" class="w-4 h-4 text-teal-400 transition-transform duration-200 accordion-chevron"></i>
            </div>
          </div>
        </summary>
        <div class="pt-3.5">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            ${SINGLE_ITEM_BUILDING_BLOCKS.map(item => {
              const count = this.singleItemCounts[item.id] || 1;
              const totalKcal = Math.round(item.kcal * count);
              const totalProtein = (item.protein * count).toFixed(1);
              const totalCarbs = (item.carbs * count).toFixed(1);
              const totalFat = (item.fat * count).toFixed(1);
              const unitLabel = count === 1 ? item.unitName : (item.unitNamePlural || item.unitName);

              return `
                <div class="single-item-card food-card bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col justify-between gap-3 shadow-sm hover:border-emerald-500/40 transition-all" data-item-id="${item.id}">
                  <div class="flex items-start gap-2.5">
                    <div class="food-thumbnail-container w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-slate-700/60 bg-slate-900/90 overflow-hidden shrink-0 flex items-center justify-center">
                      ${isValidImageUrl(item.image) ? `
                        <img
                          src="${item.image}"
                          alt="${item.name}"
                          class="food-thumbnail-img w-full h-full object-cover"
                          loading="lazy"
                          onerror="this.remove(); const fb = this.parentElement?.querySelector('.food-thumbnail-fallback'); if(fb) fb.classList.remove('hidden');"
                        />
                        <span class="hidden food-thumbnail-fallback text-2xl select-none">${item.icon || '🥣'}</span>
                      ` : `
                        <span class="food-thumbnail-fallback text-2xl select-none">${item.icon || '🥣'}</span>
                      `}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between gap-1 mb-1">
                        <span class="font-bold text-xs text-slate-100 truncate" title="${item.name}">${item.name}</span>
                        <span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0 whitespace-nowrap">${item.badge}</span>
                      </div>
                      <!-- Dynamic live nutrition preview -->
                      <div class="single-item-preview food-macro-pills text-[10.5px] text-slate-300 font-medium py-1 px-1.5 rounded-lg bg-slate-900/80 border border-slate-800/60">
                        <span class="food-macro-pill text-emerald-400 font-bold">${count} ${unitLabel}: ${totalKcal} קק״ל</span>
                        <span class="food-macro-pill text-emerald-300 font-medium">חלבון: <strong class="text-emerald-200">${totalProtein}g</strong></span>
                        <span class="food-macro-pill text-slate-300">פח': ${totalCarbs}g</span>
                        <span class="food-macro-pill text-slate-300">שומן: ${totalFat}g</span>
                      </div>
                    </div>
                  </div>

                  <!-- Interactive Stepper and Log Action Bar -->
                  <div class="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
                    <div class="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
                      <button
                        type="button"
                        aria-label="הפחת כמות עבור ${item.name}"
                        data-action="dec"
                        data-item-id="${item.id}"
                        class="single-item-stepper-btn item-stepper-btn w-11 h-11 min-w-[44px] min-h-[44px] rounded-lg text-sm font-black flex items-center justify-center cursor-pointer transition-all hover:bg-slate-800 text-slate-200 hover:text-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed"
                        ${count <= 1 ? 'disabled' : ''}
                      >
                        -
                      </button>
                      <span class="single-item-count-display min-w-[28px] text-center font-black text-sm text-slate-100">${count}</span>
                      <button
                        type="button"
                        aria-label="הגדל כמות עבור ${item.name}"
                        data-action="inc"
                        data-item-id="${item.id}"
                        class="single-item-stepper-btn item-stepper-btn w-11 h-11 min-w-[44px] min-h-[44px] rounded-lg text-sm font-black flex items-center justify-center cursor-pointer transition-all hover:bg-slate-800 text-slate-200 hover:text-emerald-400"
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      data-item-id="${item.id}"
                      class="single-item-log-btn item-log-btn flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-900/20 cursor-pointer active:scale-95 transition-all"
                    >
                      <i data-lucide="plus-circle" class="w-4 h-4"></i>
                      <span>רשום</span>
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <!-- Bottom Collapse Button -->
          <div class="pt-3.5 mt-3 border-t border-slate-800/80 flex justify-center">
            <button
              type="button"
              data-collapse-card="meals-single-items-acc"
              class="px-5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700/70 text-xs font-bold text-slate-300 hover:text-teal-300 flex items-center gap-2 transition-all cursor-pointer shadow-sm min-h-[38px] active:scale-95"
            >
              <i data-lucide="chevron-up" class="w-4 h-4 text-teal-400"></i>
              <span>כווץ כרטיס רכיבים בודדים ▲</span>
            </button>
          </div>
        </div>
      </details>
    `;
  }

  renderCardCustomMeal(isFirst, isLast) {
    const sharedMeals = state.customMeals || [];

    return `
      <details id="meals-custom-acc" data-card-id="custom_meal" class="reorderable-card accordion-card dashboard-card group border-slate-700/50" ${this.isAccordionOpen('meals_custom', false) ? 'open' : ''}>
        <summary class="cursor-pointer list-none flex items-center justify-between select-none pb-2 border-b border-slate-800/80 w-full overflow-hidden">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="card-reorder-vertical-group" onclick="event.stopPropagation()">
              <button type="button" data-move-card-up="custom_meal" class="card-reorder-btn" title="הזז למעלה" ${isFirst ? 'disabled' : ''} aria-label="הזז למעלה">
                <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
              </button>
              <div class="card-drag-handle" title="גרור לשינוי סדר כרטיסים" draggable="true" aria-label="ידית גרירה לשינוי סדר">
                <i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i>
              </div>
              <button type="button" data-move-card-down="custom_meal" class="card-reorder-btn" title="הזז למטה" ${isLast ? 'disabled' : ''} aria-label="הזז למטה">
                <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
              </button>
            </div>
            <div class="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <i data-lucide="utensils" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm font-black text-slate-100 truncate">הוספת ארוחה וקטלוג מותאם אישית (ענן)</h3>
                <span class="card-count-badge shrink-0">${sharedMeals.length} ארוחות משותפות</span>
              </div>
              <p class="text-[11px] text-slate-400 truncate">הזן ארוחה חופשית או בחר מקטלוג הארוחות המשותף של הצוות</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0 pr-2">
            <div class="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 text-xs font-bold text-slate-300 hover:text-emerald-300 flex items-center gap-1.5 transition-all shadow-sm shrink-0 min-h-[36px] whitespace-nowrap">
              <span class="hidden xs:inline sm:inline">כיווץ / הרחבה</span>
              <i data-lucide="chevron-down" class="w-4 h-4 text-emerald-400 transition-transform duration-200 accordion-chevron"></i>
            </div>
          </div>
        </summary>
        <form id="meal-form" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-3.5">
          <div class="lg:col-span-2">
            <label class="block text-xs text-slate-400 mb-1">שם המנה / הארוחה</label>
            <input type="text" id="meal-name" required placeholder="למשל: סלט חזה עוף וקינואה" class="input-field text-xs" />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">קלוריות (kcal)</label>
            <input type="number" step="any" id="meal-kcal" required placeholder="0" class="input-field text-xs" />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">חלבון (g)</label>
            <input type="number" step="any" id="meal-protein" required placeholder="0" class="input-field text-xs" />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">פחמימה (g)</label>
            <input type="number" step="any" id="meal-carbs" required placeholder="0" class="input-field text-xs" />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">שומן (g)</label>
            <input type="number" step="any" id="meal-fat" required placeholder="0" class="input-field text-xs" />
          </div>
          <div class="sm:col-span-2 lg:col-span-6 flex flex-col sm:flex-row items-center justify-between gap-2 pt-1">
            <span class="text-[11px] text-emerald-400/90 flex items-center gap-1.5 self-start sm:self-center">
              <i data-lucide="cloud-upload" class="w-3.5 h-3.5"></i>
              נשמר ביומן היום ומסונכרן אוטומטית לקטלוג המשותף בענן
            </span>
            <button type="submit" class="btn-primary text-xs w-full sm:w-auto py-2.5 px-4 font-bold flex items-center justify-center gap-1.5 cursor-pointer">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>הוסף ליומן ולקטלוג</span>
            </button>
          </div>
        </form>

        <!-- Shared Custom Meals Catalog List -->
        ${sharedMeals.length > 0 ? `
          <div class="mt-4 pt-3 border-t border-slate-800/80 space-y-2.5">
            <div class="flex items-center justify-between text-xs font-bold text-slate-300">
              <span class="flex items-center gap-1.5 text-emerald-400">
                <i data-lucide="layers" class="w-3.5 h-3.5"></i>
                קטלוג ארוחות מותאמות ומשותפות בענן:
              </span>
              <span class="text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full">${sharedMeals.length} מנות</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto p-0.5">
              ${sharedMeals.map(meal => {
                const canDelete = state.isSuperAdmin || (state.authUser && (state.authUser.email === meal.createdByUser || state.authUser.uid === meal.createdByUid));
                return `
                  <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-emerald-500/40 transition-all flex flex-col justify-between gap-2 shadow-sm">
                    <div>
                      <div class="flex items-start justify-between gap-2">
                        <div class="font-bold text-xs text-slate-100">${meal.name}</div>
                        ${canDelete ? `
                          <button
                            type="button"
                            data-delete-custom-meal="${meal.id}"
                            title="מחק מקטלוג הענן"
                            class="text-slate-500 hover:text-red-400 p-1 rounded transition-colors cursor-pointer"
                          >
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                          </button>
                        ` : ''}
                      </div>
                      <div class="flex items-center gap-2 text-[11px] text-slate-400 mt-1 font-medium">
                        <span class="font-black text-emerald-400">${meal.kcal} kcal</span>
                        <span>•</span>
                        <span>ח: ${meal.protein}g</span>
                        <span>•</span>
                        <span>פ: ${meal.carbs}g</span>
                        <span>•</span>
                        <span>ש: ${meal.fat}g</span>
                      </div>
                      ${meal.createdByDisplayName ? `
                        <div class="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1">
                          <i data-lucide="user" class="w-3 h-3"></i>
                          <span>נוצר ע"י ${meal.createdByDisplayName}</span>
                        </div>
                      ` : ''}
                    </div>
                    <button
                      type="button"
                      data-log-custom-meal="${meal.id}"
                      class="w-full py-2 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-1 active:scale-95"
                    >
                      <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
                      <span>הוסף ליומן של היום</span>
                    </button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : `
          <div class="mt-3 pt-2.5 border-t border-slate-800 text-center py-2 text-xs text-slate-500">
            עדיין אין ארוחות בקטלוג המשותף. כל ארוחה שתוסיף בטופס למעלה תישמר אוטומטית בענן ותהיה זמינה לכל הצוות!
          </div>
        `}

        <!-- Bottom Collapse Button -->
        <div class="pt-3.5 mt-3 border-t border-slate-800/80 flex justify-center">
          <button
            type="button"
            data-collapse-card="meals-custom-acc"
            class="px-5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700/70 text-xs font-bold text-slate-300 hover:text-emerald-300 flex items-center gap-2 transition-all cursor-pointer shadow-sm min-h-[38px] active:scale-95"
          >
            <i data-lucide="chevron-up" class="w-4 h-4 text-emerald-400"></i>
            <span>כווץ כרטיס ארוחות מותאמות ▲</span>
          </button>
        </div>
      </details>
    `;
  }

  renderCardHerbalife(isFirst, isLast, shakeNutrition, isGranit) {
    return `
      <details id="meals-herbalife-acc" data-card-id="herbalife" class="reorderable-card accordion-card dashboard-card bg-gradient-to-br from-slate-900 via-slate-900/90 to-cyan-950/30 border-cyan-500/40 p-4 sm:p-5 group" ${this.isAccordionOpen('meals_herbalife', true) ? 'open' : ''}>
        <summary class="cursor-pointer list-none flex items-center justify-between pb-3 select-none border-b border-slate-800 w-full overflow-hidden">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="card-reorder-vertical-group" onclick="event.stopPropagation()">
              <button type="button" data-move-card-up="herbalife" class="card-reorder-btn" title="הזז למעלה" ${isFirst ? 'disabled' : ''} aria-label="הזז למעלה">
                <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
              </button>
              <div class="card-drag-handle" title="גרור לשינוי סדר כרטיסים" draggable="true" aria-label="ידית גרירה לשינוי סדר">
                <i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i>
              </div>
              <button type="button" data-move-card-down="herbalife" class="card-reorder-btn" title="הזז למטה" ${isLast ? 'disabled' : ''} aria-label="הזז למטה">
                <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
              </button>
            </div>
            <div class="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 text-xl font-bold shrink-0">
              🥤
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-base font-extrabold text-slate-100 flex items-center gap-2 truncate">
                  שייקים ומוצרי Herbalife
                </h3>
                <span class="card-count-badge shrink-0">3 שייקים + חטיפים</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${isGranit ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}">
                  ${state.getCurrentProfile().hebrewName}
                </span>
              </div>
              <p class="text-xs text-slate-400 truncate">
                ${isGranit 
                  ? '3 השייקים היומיים הקבועים של גרניט (בוקר, ערב, אימון), חטיפי חלבון Herbalife, או הרכבה חופשית.' 
                  : 'חטיפי חלבון Herbalife, הרכבת שייק חופשי, או 3 השייקים הקבועים של גרניט.'}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2.5 shrink-0 pr-2">
            <!-- Live Shake Summary Badge -->
            <div class="hidden sm:flex items-center gap-2 bg-slate-950/80 px-2 py-1 rounded-lg border border-slate-800 text-center text-xs">
              <span class="text-emerald-400 font-bold">${shakeNutrition.kcal} kcal</span>
              <span class="text-slate-600">•</span>
              <span class="text-blue-400 font-bold">${shakeNutrition.protein}g חלבון</span>
            </div>
            <div class="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 text-xs font-bold text-slate-300 hover:text-cyan-300 flex items-center gap-1.5 transition-all shadow-sm shrink-0 min-h-[36px] whitespace-nowrap">
              <span class="hidden xs:inline sm:inline">כיווץ / הרחבה</span>
              <i data-lucide="chevron-down" class="w-4 h-4 text-cyan-400 transition-transform duration-200 accordion-chevron"></i>
            </div>
          </div>
        </summary>

        <div class="space-y-4 pt-3.5">
          <!-- 3 Recurring Daily Herbalife Presets (Instant Log) -->
          <div class="space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-black text-slate-200">3 שייקים קבועים (גרניט) - רישום מיידי בטאפ אחד:</span>
              <span class="text-[10px] text-cyan-400 font-bold">1-Tap Fast Log</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              ${GRANIT_SHAKE_PRESETS.map(shake => `
                <div class="shake-preset-card food-card rounded-xl p-3.5 border flex flex-col justify-between space-y-2.5 ${shake.theme}">
                  <div class="flex items-start gap-2.5">
                    <div class="food-thumbnail-container w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-slate-700/60 bg-slate-900/90 overflow-hidden shrink-0 flex items-center justify-center">
                      ${isValidImageUrl(shake.image) ? `
                        <img
                          src="${shake.image}"
                          alt="${shake.name}"
                          class="food-thumbnail-img w-full h-full object-cover"
                          loading="lazy"
                          onerror="this.remove(); const fb = this.parentElement?.querySelector('.food-thumbnail-fallback'); if(fb) fb.classList.remove('hidden');"
                        />
                        <span class="hidden food-thumbnail-fallback text-2xl select-none">${shake.icon || '🥤'}</span>
                      ` : `
                        <span class="food-thumbnail-fallback text-2xl select-none">${shake.icon || '🥤'}</span>
                      `}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between gap-1 mb-1">
                        <span class="text-xs font-black text-slate-100 truncate" title="${shake.name}">${shake.name}</span>
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap ${shake.badgeColor}">${shake.badge}</span>
                      </div>
                      <p class="text-[11px] text-slate-300 font-medium leading-tight line-clamp-2">${shake.recipe}</p>
                    </div>
                  </div>

                  <div class="food-macro-pills flex items-center justify-between text-xs font-bold text-slate-300 bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span class="text-emerald-400">${shake.kcal} kcal</span>
                    <span class="text-slate-600">•</span>
                    <span class="text-blue-400">${shake.protein}g חלבון</span>
                    <span class="text-slate-600">•</span>
                    <span class="text-amber-400">${shake.carbs}g פח'</span>
                    <span class="text-slate-600">•</span>
                    <span class="text-purple-400">${shake.fat}g שומן</span>
                  </div>

                  <button
                    type="button"
                    data-log-granit-shake-meals="${shake.id}"
                    class="w-full py-2.5 px-3 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer transition-all ${shake.btnClass} min-h-[44px]"
                  >
                    <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
                    <span>רשום ${shake.name}</span>
                  </button>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Herbalife Products / Snacks (Instant Log) -->
          <div class="space-y-2.5 pt-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-black text-slate-200">מוצרי וחטיפי Herbalife - רישום מיידי בטאפ אחד:</span>
              <span class="text-[10px] text-orange-400 font-bold">1-Tap Fast Log</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              ${HERBALIFE_PRODUCTS.map(product => `
                <div class="food-card rounded-xl p-3.5 border flex flex-col justify-between space-y-2.5 ${product.theme || 'border-orange-500/50 bg-gradient-to-br from-orange-500/15 via-slate-900 to-slate-950'}">
                  <div class="flex items-start gap-2.5">
                    <div class="food-thumbnail-container w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-slate-700/60 bg-slate-900/90 overflow-hidden shrink-0 flex items-center justify-center">
                      ${isValidImageUrl(product.image) ? `
                        <img
                          src="${product.image}"
                          alt="${product.name}"
                          class="food-thumbnail-img w-full h-full object-cover"
                          loading="lazy"
                          onerror="this.remove(); const fb = this.parentElement?.querySelector('.food-thumbnail-fallback'); if(fb) fb.classList.remove('hidden');"
                        />
                        <span class="hidden food-thumbnail-fallback text-2xl select-none">${product.icon || '🥔'}</span>
                      ` : `
                        <span class="food-thumbnail-fallback text-2xl select-none">${product.icon || '🥔'}</span>
                      `}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between gap-1 mb-1">
                        <span class="text-xs font-black text-slate-100 truncate" title="${product.name}">${product.name}</span>
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap ${product.badgeColor || 'bg-orange-500/20 text-orange-300 border border-orange-500/40'}">${product.badge}</span>
                      </div>
                      <p class="text-[11px] text-slate-300 font-medium leading-tight line-clamp-2">${product.recipe || product.servingSize || ''}</p>
                    </div>
                  </div>

                  <div class="food-macro-pills flex items-center justify-between text-xs font-bold text-slate-300 bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                    <span class="text-emerald-400">${product.kcal} kcal</span>
                    <span class="text-slate-600">•</span>
                    <span class="text-blue-400">${product.protein}g חלבון</span>
                    <span class="text-slate-600">•</span>
                    <span class="text-amber-400">${product.carbs}g פח'</span>
                    <span class="text-slate-600">•</span>
                    <span class="text-purple-400">${product.fat}g שומן</span>
                  </div>

                  <button
                    type="button"
                    id="btn-herbalife-protein-chips"
                    data-log-herbalife-product="${product.id}"
                    data-product-name="${product.name}"
                    class="herbalife-product-btn w-full py-2.5 px-3 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer transition-all ${product.btnClass || 'bg-orange-500 hover:bg-orange-400 text-slate-950'} min-h-[44px]"
                  >
                    <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
                    <span>רשום ${product.name}</span>
                  </button>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="border-t border-slate-800 my-2 pt-2 flex items-center justify-between">
            <span class="text-xs font-bold text-slate-400">או הרכב שייק חופשי לפי מספר כפות:</span>
            <span class="text-[11px] text-slate-500">מינון גמיש</span>
          </div>

          <!-- 3 Herbalife Ingredients Grid -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            ${HERBALIFE_INGREDIENTS.map(item => {
              const count = this.granitShake[item.id] || 0;
              return `
                <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/90 flex flex-col justify-between space-y-3">
                  <div class="flex items-start gap-3">
                    ${isValidImageUrl(item.image) ? `
                      <img
                        src="${item.image}"
                        alt="${item.name}"
                        class="w-14 h-14 rounded-lg object-cover border border-slate-700/60 shadow-sm shrink-0"
                        loading="lazy"
                        onerror="this.remove(); const fb = this.parentElement?.querySelector('.food-thumbnail-fallback'); if(fb) fb.classList.remove('hidden');"
                      />
                      <div class="hidden food-thumbnail-fallback w-14 h-14 rounded-lg bg-slate-900 border border-slate-700/60 flex items-center justify-center text-2xl shadow-sm shrink-0 select-none">${item.icon || '🥤'}</div>
                    ` : `
                      <div class="w-14 h-14 rounded-lg bg-slate-900 border border-slate-700/60 flex items-center justify-center text-2xl shadow-sm shrink-0 select-none">${item.icon || '🥤'}</div>
                    `}
                    <div class="min-w-0">
                      <div class="text-[10px] font-bold text-cyan-400 uppercase tracking-wide">${item.badge}</div>
                      <h4 class="text-xs font-bold text-slate-100 truncate" title="${item.hebrewName}">${item.hebrewName}</h4>
                      <div class="text-[11px] text-slate-400">${item.flavor}</div>
                      <div class="text-[10px] text-slate-500 mt-0.5">כף (סקופ): ${item.perScoop.kcal} kcal | P: ${item.perScoop.protein}g | C: ${item.perScoop.carbs}g</div>
                    </div>
                  </div>

                  <!-- Scoop Stepper -->
                  <div class="flex items-center justify-between bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                    <span class="text-xs font-semibold text-slate-300">כמות כפות:</span>
                    <div class="flex items-center gap-2">
                      <button type="button" data-shake-dec="${item.id}" class="scoop-btn" ${count <= 0 ? 'disabled' : ''}>-</button>
                      <span class="text-base font-black text-slate-100 w-6 text-center">${count}</span>
                      <button type="button" data-shake-inc="${item.id}" class="scoop-btn" ${count >= 6 ? 'disabled' : ''}>+</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <!-- Liquid & Action Row -->
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
            <div class="flex items-center gap-2 text-xs">
              <span class="text-slate-400 whitespace-nowrap">בסיס נוזל:</span>
              <select id="shake-liquid-select" class="input-field py-2 text-xs font-medium cursor-pointer">
                ${SHAKE_LIQUIDS.map(liq => `
                  <option value="${liq.id}" ${liq.id === this.granitShake.liquidId ? 'selected' : ''}>
                    ${liq.name} (${liq.kcal} kcal, ${liq.protein}g חלבון)
                  </option>
                `).join('')}
              </select>
            </div>

            <button id="btn-log-herbalife-shake" class="btn-primary text-xs font-bold py-2.5 px-6 flex items-center justify-center gap-2 shadow-md cursor-pointer">
              <i data-lucide="plus-circle" class="w-4 h-4"></i>
              <span>רשום שייק ביומן (${shakeNutrition.kcal} kcal | ${shakeNutrition.protein}g חלבון)</span>
            </button>
          </div>
          <div id="shake-log-alert" class="hidden p-2.5 rounded-xl text-xs font-bold text-center"></div>

          <!-- Bottom Collapse Button -->
          <div class="pt-3.5 mt-3 border-t border-slate-800/80 flex justify-center">
            <button
              type="button"
              data-collapse-card="meals-herbalife-acc"
              class="px-5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700/70 text-xs font-bold text-slate-300 hover:text-cyan-300 flex items-center gap-2 transition-all cursor-pointer shadow-sm min-h-[38px] active:scale-95"
            >
              <i data-lucide="chevron-up" class="w-4 h-4 text-cyan-400"></i>
              <span>כווץ כרטיס Herbalife ▲</span>
            </button>
          </div>
        </div>
      </details>
    `;
  }

  // --- MEALS VIEW WITH HERBALIFE SHAKE BUILDER ---
  getMealsHTML() {
    const user = state.activeUser;
    const isGranit = user === 'Granit';
    const dateStr = state.selectedDate;
    const meals = getMealsForDate(user, dateStr);
    const macros = calculateDailyMacros(meals);
    const profile = state.getCurrentProfile();
    const shakeNutrition = calculateShakeNutrition(this.granitShake, this.granitShake.liquidId);

    // Reorderable cards logic
    const order = this.getNutritionCardsOrder();
    const isHerbalifeEnabled = isGranit || localStorage.getItem('nutrition_show_herbalife') === 'true';
    const visibleOrder = order.filter(id => id !== 'herbalife' || isHerbalifeEnabled);

    const renderedCards = visibleOrder.map((cardId, index) => {
      const isFirst = index === 0;
      const isLast = index === visibleOrder.length - 1;
      switch (cardId) {
        case 'ready_meals':
          return this.renderCardReadyMeals(isFirst, isLast);
        case 'single_items':
          return this.renderCardSingleItems(isFirst, isLast);
        case 'custom_meal':
          return this.renderCardCustomMeal(isFirst, isLast);
        case 'herbalife':
          return this.renderCardHerbalife(isFirst, isLast, shakeNutrition, isGranit);
        default:
          return '';
      }
    }).join('');

    return `
      <div class="space-y-6">
        <!-- Nutrition Header with Date Stepper -->
        <div class="dashboard-card flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 class="text-xl font-extrabold text-slate-100">יומן ארוחות</h2>
            <p class="text-xs text-slate-400">
              ${isGranit ? 'ניהול תזונה יומי, רישום שייקים Herbalife, מנות מהירות ורכיבים מדודים.' : 'ניהול תזונה יומי, רישום מנות מוכנות ורכיבים מדודים.'}
            </p>
          </div>
          <div class="flex items-center gap-1.5 bg-slate-950/70 p-1.5 rounded-xl border border-slate-800">
            <button id="meals-date-prev" type="button" class="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 flex items-center justify-center transition-colors cursor-pointer" title="יום קודם">
              <i data-lucide="chevron-right" class="w-4 h-4"></i>
            </button>
            <button id="meals-date-today" type="button" class="px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer" title="חזרה לתאריך היום">
              יום
            </button>
            <input type="date" id="meals-date-picker" value="${dateStr}" class="bg-transparent text-slate-100 text-xs font-bold px-1.5 focus:outline-none cursor-pointer" />
            <button id="meals-date-next" type="button" class="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 flex items-center justify-center transition-colors cursor-pointer" title="יום הבא">
              <i data-lucide="chevron-left" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <!-- Sticky Macro & Calorie Horizontal Progress Bars (Visual Budget & Remaining Tracker) -->
        ${this.getMacroBudgetProgressBarsHTML(macros, profile, true)}

        <!-- Card Reordering Controls & Helper -->
        <div class="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400">
          <div class="flex items-center gap-1.5">
            <i data-lucide="arrow-up-down" class="w-3.5 h-3.5 text-emerald-400"></i>
            <span>סדר מודולים גמיש: גרור את הידית (<strong class="text-slate-300">⋮⋮</strong>) או השתמש בחצים (▲/▼)</span>
          </div>
          <div class="flex items-center gap-2">
            ${!isGranit ? `
              <button id="btn-toggle-herbalife-visibility" type="button" class="text-[11px] font-bold px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-400 border border-slate-800 transition-colors cursor-pointer">
                ${isHerbalifeEnabled ? 'הסתר מודול Herbalife' : 'הצג מודול Herbalife'}
              </button>
            ` : ''}
            <button id="btn-reset-nutrition-order" type="button" class="text-[11px] font-bold px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 border border-slate-800 transition-colors cursor-pointer" title="אפס סדר כרטיסים לברירת המחדל">
              אפס סדר
            </button>
          </div>
        </div>

        <!-- 4 Separate Independent Collapsible Containers (Reorderable Accordion Cards) -->
        <div id="reorderable-nutrition-cards" class="space-y-4">
          ${renderedCards}
        </div>

        <!-- Logged Meals List -->
        <div class="dashboard-card space-y-3">
          <h3 class="text-sm font-bold text-slate-200">ארוחות שנרשמו ליום זה (${meals.length})</h3>
          ${meals.length > 0 ? `
            <div class="space-y-2">
              ${meals.map(meal => `
                <div class="flex justify-between items-center bg-slate-950/50 p-3 rounded-xl border border-slate-800">
                  <div>
                    <div class="font-bold text-sm text-slate-100 flex items-center gap-2">
                      ${meal.name}
                      ${meal.isHerbalifePreset || meal.name.includes('שייק') || meal.name.includes('Herbalife') ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">הרבלייף</span>' : ''}
                    </div>
                    ${meal.recipe ? `<div class="text-[11px] text-slate-300 font-medium mt-0.5">${meal.recipe}</div>` : ''}
                    <div class="text-xs text-slate-400 mt-0.5">
                      <span class="text-emerald-400 font-semibold">${meal.kcal} kcal</span> | חלבון: ${meal.protein}g | פחמימה: ${meal.carbs}g | שומן: ${meal.fat}g
                      <span class="mr-2 text-[10px] text-slate-500">(${meal.timestamp})</span>
                    </div>
                  </div>
                  <button data-delete-id="${meal.id}" aria-label="מחק ארוחה" class="delete-meal-btn text-slate-400 hover:text-red-400 p-2 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                  </button>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="text-center py-8 text-slate-400 text-sm">טרם הושרו ארוחות לתאריך זה. בחר מנה מהירה, שייק או הוסף ארוחה חדשה מעל.</div>
          `}
        </div>

        <!-- Scroll Clearance Spacer -->
        <div class="h-20 sm:h-24 w-full shrink-0"></div>
      </div>
    `;
  }

  bindNutritionCardReordering() {
    // Prevent drag handle or reorder button clicks from toggling accordion summary
    document.querySelectorAll('.card-drag-handle, .card-reorder-btn, .card-reorder-group').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });

    // Up/Down move buttons
    document.querySelectorAll('[data-move-card-up]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const cardId = e.currentTarget.getAttribute('data-move-card-up');
        this.moveNutritionCard(cardId, -1);
      });
    });

    document.querySelectorAll('[data-move-card-down]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const cardId = e.currentTarget.getAttribute('data-move-card-down');
        this.moveNutritionCard(cardId, 1);
      });
    });

    // Reset order button
    const resetBtn = document.getElementById('btn-reset-nutrition-order');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const defaultOrder = ['ready_meals', 'single_items', 'custom_meal', 'herbalife'];
        this.setNutritionCardsOrder(defaultOrder);
        try {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(40);
          }
        } catch (e) {}
        this.render();
        this.showToast('סדר הכרטיסים אופס לברירת המחדל ✓');
      });
    }

    // Toggle Herbalife visibility for Arik button
    const toggleHerbalifeBtn = document.getElementById('btn-toggle-herbalife-visibility');
    if (toggleHerbalifeBtn) {
      toggleHerbalifeBtn.addEventListener('click', () => {
        const current = localStorage.getItem('nutrition_show_herbalife') === 'true';
        const next = !current;
        localStorage.setItem('nutrition_show_herbalife', next ? 'true' : 'false');
        try {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(30);
          }
        } catch (e) {}
        this.render();
        this.showToast(next ? 'שייקים ומוצרי Herbalife מוצגים כעת ✓' : 'שייקים ומוצרי Herbalife הוסתרו ✓');
      });
    }

    // HTML5 Drag & Drop (Desktop & Pointer)
    const cardsContainer = document.getElementById('reorderable-nutrition-cards');
    if (!cardsContainer) return;

    let draggedCardId = null;

    document.querySelectorAll('.card-drag-handle').forEach(handle => {
      handle.setAttribute('draggable', 'true');

      handle.addEventListener('dragstart', (e) => {
        const card = handle.closest('.reorderable-card');
        if (!card) return;
        draggedCardId = card.getAttribute('data-card-id');
        e.dataTransfer.setData('text/plain', draggedCardId);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('card-dragging');
        try {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(40);
          }
        } catch (err) {}
      });

      handle.addEventListener('dragend', () => {
        draggedCardId = null;
        document.querySelectorAll('.reorderable-card').forEach(c => {
          c.classList.remove('card-dragging', 'drop-target-active');
        });
      });
    });

    cardsContainer.querySelectorAll('.reorderable-card').forEach(card => {
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetId = card.getAttribute('data-card-id');
        if (draggedCardId && targetId !== draggedCardId) {
          card.classList.add('drop-target-active');
        }
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drop-target-active');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drop-target-active');
        const sourceId = e.dataTransfer.getData('text/plain') || draggedCardId;
        const targetId = card.getAttribute('data-card-id');

        if (sourceId && targetId && sourceId !== targetId) {
          const isGranit = state.activeUser === 'Granit';
          const isHerbalifeEnabled = isGranit || localStorage.getItem('nutrition_show_herbalife') === 'true';
          const order = this.getNutritionCardsOrder();
          const visible = order.filter(id => id !== 'herbalife' || isHerbalifeEnabled);

          const fromIdx = visible.indexOf(sourceId);
          const toIdx = visible.indexOf(targetId);

          if (fromIdx !== -1 && toIdx !== -1) {
            visible.splice(fromIdx, 1);
            visible.splice(toIdx, 0, sourceId);

            const newFullOrder = [...visible];
            order.forEach(id => {
              if (!newFullOrder.includes(id)) newFullOrder.push(id);
            });

            this.setNutritionCardsOrder(newFullOrder);
            try {
              if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(40);
              }
            } catch (err) {}
            this.render();
            this.showToast('סדר הכרטיסים עודכן בהצלחה! ✓');
          }
        }
      });
    });

    // Native Touch Drag & Drop for Mobile
    let touchCard = null;
    let touchSourceId = null;
    let touchTargetCard = null;

    document.querySelectorAll('.card-drag-handle').forEach(handle => {
      handle.addEventListener('touchstart', (e) => {
        const card = handle.closest('.reorderable-card');
        if (!card) return;
        touchCard = card;
        touchSourceId = card.getAttribute('data-card-id');
        touchTargetCard = null;
        touchCard.classList.add('card-dragging');
        try {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(40);
          }
        } catch (err) {}
      }, { passive: true });

      handle.addEventListener('touchmove', (e) => {
        if (!touchCard) return;
        const touch = e.touches[0];
        const elem = document.elementFromPoint(touch.clientX, touch.clientY);
        const hoverCard = elem?.closest('.reorderable-card');

        document.querySelectorAll('.reorderable-card').forEach(c => {
          if (c !== hoverCard) c.classList.remove('drop-target-active');
        });

        if (hoverCard && hoverCard !== touchCard) {
          hoverCard.classList.add('drop-target-active');
          touchTargetCard = hoverCard;
        } else {
          touchTargetCard = null;
        }
      }, { passive: true });

      handle.addEventListener('touchend', () => {
        if (touchCard) {
          touchCard.classList.remove('card-dragging');
          if (touchTargetCard && touchSourceId) {
            const targetId = touchTargetCard.getAttribute('data-card-id');
            if (targetId && targetId !== touchSourceId) {
              const isGranit = state.activeUser === 'Granit';
              const isHerbalifeEnabled = isGranit || localStorage.getItem('nutrition_show_herbalife') === 'true';
              const order = this.getNutritionCardsOrder();
              const visible = order.filter(id => id !== 'herbalife' || isHerbalifeEnabled);

              const fromIdx = visible.indexOf(touchSourceId);
              const toIdx = visible.indexOf(targetId);

              if (fromIdx !== -1 && toIdx !== -1) {
                visible.splice(fromIdx, 1);
                visible.splice(toIdx, 0, touchSourceId);

                const newFullOrder = [...visible];
                order.forEach(id => {
                  if (!newFullOrder.includes(id)) newFullOrder.push(id);
                });

                this.setNutritionCardsOrder(newFullOrder);
                try {
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    navigator.vibrate(40);
                  }
                } catch (err) {}
                this.render();
                this.showToast('סדר הכרטיסים עודכן בהצלחה! ✓');
              }
            }
          }
          document.querySelectorAll('.reorderable-card').forEach(c => c.classList.remove('drop-target-active', 'card-dragging'));
          touchCard = null;
          touchSourceId = null;
          touchTargetCard = null;
        }
      });

      handle.addEventListener('touchcancel', () => {
        if (touchCard) {
          touchCard.classList.remove('card-dragging');
          document.querySelectorAll('.reorderable-card').forEach(c => c.classList.remove('drop-target-active', 'card-dragging'));
          touchCard = null;
          touchSourceId = null;
          touchTargetCard = null;
        }
      });
    });
  }

  bindMealsEvents() {
    const datePicker = document.getElementById('meals-date-picker');
    if (datePicker) {
      datePicker.addEventListener('change', (e) => {
        state.setSelectedDate(e.target.value);
      });
    }

    const prevDayBtn = document.getElementById('meals-date-prev');
    if (prevDayBtn) {
      prevDayBtn.addEventListener('click', () => {
        this.changeDateByDays(-1);
      });
    }

    const nextDayBtn = document.getElementById('meals-date-next');
    if (nextDayBtn) {
      nextDayBtn.addEventListener('click', () => {
        this.changeDateByDays(1);
      });
    }

    const todayBtn = document.getElementById('meals-date-today');
    if (todayBtn) {
      todayBtn.addEventListener('click', () => {
        const todayStr = new Date().toISOString().split('T')[0];
        if (state.selectedDate !== todayStr) {
          state.setSelectedDate(todayStr);
        }
        this.showToast('עברת לתאריך היום ✓');
      });
    }

    // Bind Accordions Persistence for all 4 standalone cards
    this.bindAccordion('meals-ready-meals-acc', 'meals_ready_meals');
    this.bindAccordion('meals-single-items-acc', 'meals_single_items');
    this.bindAccordion('meals-custom-acc', 'meals_custom');
    this.bindAccordion('meals-herbalife-acc', 'meals_herbalife');

    // Bind reordering (drag handles, buttons, touch)
    this.bindNutritionCardReordering();

    // Granit's 3 Recurring Herbalife Shakes Quick Logging in Meals tab
    document.querySelectorAll('[data-log-granit-shake-meals]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const presetId = e.currentTarget.getAttribute('data-log-granit-shake-meals');
        const newMeal = logGranitShakePreset(presetId, state.activeUser, state.selectedDate);
        if (newMeal) {
          this.showToast(`שייק "${newMeal.name}" נוסף בהצלחה ליומן של ${state.getCurrentProfile().hebrewName}! ✓`);
          const alertBox = document.getElementById('shake-log-alert');
          if (alertBox) {
            alertBox.className = 'p-3 rounded-xl text-xs font-bold text-center bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 block';
            alertBox.textContent = `✅ ${newMeal.name} (${newMeal.kcal} kcal, ${newMeal.protein}g חלבון) נוסף בהצלחה ליומן!`;
          }
          this.render();
        }
      });
    });

    // Herbalife Products / Snacks Quick Logging (e.g. Protein Chips)
    document.querySelectorAll('[data-log-herbalife-product], .herbalife-product-btn, #btn-herbalife-protein-chips').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const productId = e.currentTarget.getAttribute('data-log-herbalife-product') || 'herbalife_protein_chips';
        const product = HERBALIFE_PRODUCTS.find(p => p.id === productId) || HERBALIFE_PRODUCTS[0];
        const newMeal = logHerbalifeProduct(productId, state.activeUser, state.selectedDate);
        if (newMeal) {
          const toastMsg = (product && product.toast) ? product.toast : "צ'יפס חלבון נוסף בהצלחה! ✓";
          this.showToast(toastMsg);
          this.render();
        }
      });
    });

    // Shake builder steppers
    document.querySelectorAll('[data-shake-inc]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-shake-inc');
        if (this.granitShake[id] < 6) {
          this.granitShake[id]++;
          this.render();
        }
      });
    });

    document.querySelectorAll('[data-shake-dec]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-shake-dec');
        if (this.granitShake[id] > 0) {
          this.granitShake[id]--;
          this.render();
        }
      });
    });

    const liquidSelect = document.getElementById('shake-liquid-select');
    if (liquidSelect) {
      liquidSelect.addEventListener('change', (e) => {
        this.granitShake.liquidId = e.target.value;
        this.render();
      });
    }

    const logShakeBtn = document.getElementById('btn-log-herbalife-shake');
    if (logShakeBtn) {
      logShakeBtn.addEventListener('click', () => {
        const nutrition = calculateShakeNutrition(this.granitShake, this.granitShake.liquidId);
        const parts = [];
        if (this.granitShake.f1 > 0) parts.push(`F1 x ${this.granitShake.f1}`);
        if (this.granitShake.pdm > 0) parts.push(`PDM x ${this.granitShake.pdm}`);
        if (this.granitShake.rebuild > 0) parts.push(`Rebuild x ${this.granitShake.rebuild}`);
        const partsStr = parts.length > 0 ? parts.join(', ') : 'אישי';

        const shakeMeal = {
          name: `שייק Herbalife מותאם (${partsStr}) על בסיס ${nutrition.liquid.name}`,
          kcal: nutrition.kcal,
          protein: nutrition.protein,
          carbs: nutrition.carbs,
          fat: nutrition.fat
        };

        saveMeal(state.activeUser, state.selectedDate, shakeMeal);
        this.showToast('שייק Herbalife נוסף בהצלחה! ✓');
        this.render();
      });
    }

    // Single-Item Building Blocks Steppers (+ / -)
    document.querySelectorAll('.single-item-stepper-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const itemId = e.currentTarget.getAttribute('data-item-id');
        const action = e.currentTarget.getAttribute('data-action');
        const currentCount = this.singleItemCounts[itemId] || 1;

        if (action === 'inc') {
          this.singleItemCounts[itemId] = currentCount + 1;
        } else if (action === 'dec') {
          this.singleItemCounts[itemId] = Math.max(1, currentCount - 1);
        }

        // Live update card elements without destroying the entire page
        const card = document.querySelector(`.single-item-card[data-item-id="${itemId}"]`);
        const item = SINGLE_ITEM_BUILDING_BLOCKS.find(i => i.id === itemId);
        if (card && item) {
          const newCount = this.singleItemCounts[itemId];
          const decBtn = card.querySelector('[data-action="dec"]');
          const countDisplay = card.querySelector('.single-item-count-display');
          const preview = card.querySelector('.single-item-preview');

          if (decBtn) {
            decBtn.disabled = newCount <= 1;
          }
          if (countDisplay) {
            countDisplay.textContent = newCount;
          }
          if (preview) {
            const totalKcal = Math.round(item.kcal * newCount);
            const totalProtein = (item.protein * newCount).toFixed(1);
            const totalCarbs = (item.carbs * newCount).toFixed(1);
            const totalFat = (item.fat * newCount).toFixed(1);
            const unitLabel = newCount === 1 ? item.unitName : (item.unitNamePlural || item.unitName);

            preview.innerHTML = `
              <span class="text-emerald-400 font-bold">${newCount} ${unitLabel}:</span>
              <span>${totalKcal} קק״ל</span>
              <span class="text-slate-400">|</span>
              <span>חלבון: <strong class="text-emerald-300">${totalProtein}g</strong></span>
              <span class="text-slate-400">|</span>
              <span>פח': ${totalCarbs}g</span>
              <span class="text-slate-400">|</span>
              <span>שומן: ${totalFat}g</span>
            `;
          }
        }
      });
    });

    // Single-Item Building Blocks Log Action
    document.querySelectorAll('.single-item-log-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const itemId = e.currentTarget.getAttribute('data-item-id');
        const count = this.singleItemCounts[itemId] || 1;
        const item = SINGLE_ITEM_BUILDING_BLOCKS.find(i => i.id === itemId);

        if (item) {
          logSingleItemBuildingBlock(itemId, count, state.activeUser, state.selectedDate);
          const unitLabel = count === 1 ? item.unitName : (item.unitNamePlural || item.unitName);
          let toastMsg = `נרשמו ${count} ${unitLabel} (${item.name}) ✓`;
          if (itemId === 'olive_oil_tsp') {
            toastMsg = count === 1 ? 'כפית שמן זית נוספה ליומן! ✓' : `${count} כפיות שמן זית נוספו ליומן! ✓`;
          } else if (item.toast && count === 1) {
            toastMsg = item.toast;
          }
          this.showToast(toastMsg);
          this.render();
        }
      });
    });

    document.querySelectorAll('.quick-preset-btn, #btn-preset-smoked-salmon, #btn-preset-pita-angel, #btn-preset-toblerone-white, #btn-preset-toblerone-milk-nuts, #btn-preset-peanuts, #btn-preset-olive-oil-tsp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = e.currentTarget.getAttribute('data-preset-idx');
        const presetId = e.currentTarget.getAttribute('data-preset-id');
        let preset = null;
        if (idx !== null && idx !== undefined && idx !== '') {
          preset = QUICK_PRESETS[idx];
        } else if (presetId) {
          preset = QUICK_PRESETS.find(p => p.id === presetId);
        } else if (e.currentTarget.id === 'btn-preset-olive-oil-tsp' || presetId === 'olive_oil_tsp') {
          preset = QUICK_PRESETS.find(p => p.id === 'olive_oil_tsp');
        } else if (e.currentTarget.id === 'btn-preset-pita-angel') {
          preset = QUICK_PRESETS.find(p => p.id === 'pita_angel_118g');
        } else if (e.currentTarget.id === 'btn-preset-smoked-salmon') {
          preset = QUICK_PRESETS.find(p => p.id === 'smoked_salmon_100g');
        } else if (e.currentTarget.id === 'btn-preset-toblerone-white') {
          preset = QUICK_PRESETS.find(p => p.id === 'toblerone_white_8g');
        } else if (e.currentTarget.id === 'btn-preset-toblerone-milk-nuts') {
          preset = QUICK_PRESETS.find(p => p.id === 'toblerone_milk_nuts_8g');
        } else if (e.currentTarget.id === 'btn-preset-peanuts') {
          preset = QUICK_PRESETS.find(p => p.id === 'peanuts_30g');
        } else {
          const name = e.currentTarget.getAttribute('data-preset-name');
          if (name) preset = QUICK_PRESETS.find(p => p.name === name);
        }

        if (preset) {
          saveMeal(state.activeUser, state.selectedDate, preset);
          if (preset.id === 'olive_oil_tsp' || preset.name?.includes('שמן זית')) {
            this.showToast('כפית שמן זית נוספה ליומן! ✓');
          } else if (preset.id === 'smoked_salmon_100g' || preset.name?.includes('סלמון מעושן')) {
            this.showToast('סלמון מעושן נוסף ליומן! ✓');
          } else if (preset.id?.includes('toblerone') || preset.name?.includes('טובלרון')) {
            this.showToast('נשנוש טובלרון נוסף ליומן! ✓');
          } else if (preset.id === 'peanuts_30g' || preset.name?.includes('בוטנים')) {
            this.showToast('מנת בוטנים נוספה ליומן! ✓');
          } else if (preset.toast) {
            this.showToast(preset.toast);
          } else {
            this.showToast(`נרשם: "${preset.name}" (${preset.kcal} קק״ל) ✓`);
          }
          this.render();
        }
      });
    });

    const form = document.getElementById('meal-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const sanitizeNumberStr = (v) => String(v || '').trim().replace(',', '.');
        const meal = {
          name: document.getElementById('meal-name').value.trim(),
          kcal: sanitizeNumberStr(document.getElementById('meal-kcal').value),
          protein: sanitizeNumberStr(document.getElementById('meal-protein').value),
          carbs: sanitizeNumberStr(document.getElementById('meal-carbs').value),
          fat: sanitizeNumberStr(document.getElementById('meal-fat').value),
        };

        const saved = saveMeal(state.activeUser, state.selectedDate, meal);

        // Sync to shared cloud custom_meals collection
        try {
          await addCustomMealToCloud({
            id: saved.id,
            name: meal.name,
            kcal: Number(meal.kcal) || 0,
            protein: Number(meal.protein) || 0,
            carbs: Number(meal.carbs) || 0,
            fat: Number(meal.fat) || 0
          });
        } catch (cloudErr) {
          console.warn('Cloud custom meal sync error:', cloudErr);
        }

        this.showToast(`הארוחה "${meal.name}" נוספה ליומן ולקטלוג המשותף בענן! ✓`);
        this.render();
      });
    }

    // Quick log from shared custom meals catalog
    document.querySelectorAll('[data-log-custom-meal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mealId = e.currentTarget.getAttribute('data-log-custom-meal');
        const customMeal = (state.customMeals || []).find(m => m.id === mealId);
        if (customMeal) {
          saveMeal(state.activeUser, state.selectedDate, {
            name: customMeal.name,
            kcal: customMeal.kcal,
            protein: customMeal.protein,
            carbs: customMeal.carbs,
            fat: customMeal.fat
          });
          this.showToast(`הארוחה "${customMeal.name}" נוספה ליומן של היום! ✓`);
          this.render();
        }
      });
    });

    // Delete meal from shared custom meals catalog
    document.querySelectorAll('[data-delete-custom-meal]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const mealId = e.currentTarget.getAttribute('data-delete-custom-meal');
        if (!mealId) return;
        if (confirm('האם למחוק ארוחה זו מהקטלוג המשותף בענן?')) {
          try {
            await deleteCustomMealFromCloud(mealId);
            this.showToast('הארוחה הוסרה מהקטלוג המשותף בענן', 'info');
          } catch (err) {
            console.error('Failed to delete custom meal from cloud:', err);
            this.showToast('שגיאה במחיקת הארוחה מהקטלוג בענן', 'error');
          }
        }
      });
    });

    document.querySelectorAll('.delete-meal-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-delete-id');
        deleteMeal(state.activeUser, state.selectedDate, id);
        this.showToast('הארוחה נמחקה מהיומן', 'info');
        this.render();
      });
    });
  }

  // --- COMBINED MULTI-METRIC TANITA CHART (COLLAPSIBLE CARD) ---
  renderCardCombinedTanitaChart(history) {
    const isNormalized = this.combinedScaleMode === 'normalized';
    const hidden = this.combinedHiddenMetrics || [];

    return `
      <details id="tanita-combined-chart-acc" class="accordion-card dashboard-card group p-0 overflow-hidden border-indigo-500/30" ${this.isAccordionOpen('tanita_combined_chart', true) ? 'open' : ''}>
        <summary class="cursor-pointer list-none flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 sm:p-5 select-none border-b border-slate-800/80 bg-slate-900/30 hover:bg-slate-800/30 transition-colors">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <i data-lucide="layers" class="w-5 h-5"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-sm sm:text-base font-extrabold text-slate-100">תרשים משולב רב-מדדי (Multi-Line Chart)</h3>
                <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">11 מדדים יחד</span>
                <button type="button" data-tanita-info="combined" class="w-5 h-5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-indigo-400 border border-slate-700/60 flex items-center justify-center text-[10px] font-black transition-colors cursor-pointer" title="מידע והסבר על התרשים המשולב">
                  ?
                </button>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">ניתוח מגמות סימולטני של כל 11 מדדי הטניטה על ציר זמן רציף יחיד (ערך גולמי או % שינוי מנורמל)</p>
            </div>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-center">
            <div class="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/80 text-xs font-bold text-slate-200 hover:text-indigo-300 flex items-center gap-2 transition-all shadow-sm shrink-0 min-h-[38px] whitespace-nowrap">
              <span>כיווץ / הרחבה</span>
              <i data-lucide="chevron-down" class="w-4 h-4 text-indigo-400 transition-transform duration-200 accordion-chevron"></i>
            </div>
          </div>
        </summary>

        <div class="p-4 sm:p-5 space-y-4">
          <!-- Top Controls Bar: Scale Mode & Quick Presets -->
          <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b border-slate-800/80">
            <!-- Scale Mode Switcher -->
            <div class="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
              <span class="text-xs font-bold text-slate-400 px-2 shrink-0">סרגל מדידה:</span>
              <button
                type="button"
                data-combined-scale="original"
                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  !isNormalized ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }"
              >
                ערכים מקוריים (Dual-Axis)
              </button>
              <button
                type="button"
                data-combined-scale="normalized"
                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  isNormalized ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }"
              >
                מגמת שינוי % יחסית (נרמול מ-0%)
              </button>
            </div>

            <!-- Quick Filter Preset Actions -->
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[11px] font-bold text-slate-400 hidden sm:inline">פילטר מהיר:</span>
              <button type="button" data-combined-action="select_all" class="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer">
                הצג הכל (11)
              </button>
              <button type="button" data-combined-preset="fat_loss" class="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-all cursor-pointer">
                חיטוב ושומן (4)
              </button>
              <button type="button" data-combined-preset="muscle_quality" class="text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 transition-all cursor-pointer">
                שריר ואיכות (4)
              </button>
              <button type="button" data-combined-action="clear_all" class="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-400 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer">
                נקה הכל
              </button>
            </div>
          </div>

          <!-- 11 Metric Toggle Chips -->
          <div>
            <div class="text-[11px] font-bold text-slate-400 mb-2 flex items-center justify-between">
              <span>בחר מדדים להצגה בתרשים (לחץ להפעלה / הסתרה):</span>
              <span class="text-[10px] text-indigo-400 font-bold">${TANITA_METRIC_CONFIGS.length - hidden.length} מתוך ${TANITA_METRIC_CONFIGS.length} פעילים</span>
            </div>
            <div class="flex items-center gap-1.5 flex-wrap">
              ${TANITA_METRIC_CONFIGS.map(m => {
                const isHidden = hidden.includes(m.key);
                return `
                  <button
                    type="button"
                    data-toggle-combined-metric="${m.key}"
                    class="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                      !isHidden
                        ? 'bg-slate-900 text-slate-200 border-slate-700 shadow-sm'
                        : 'bg-slate-950/40 text-slate-500 border-slate-800/60 opacity-40 hover:opacity-75'
                    }"
                    style="${!isHidden ? `border-color: ${m.color}80; background-color: ${m.color}15;` : ''}"
                  >
                    <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${m.color}; opacity: ${isHidden ? 0.3 : 1};"></span>
                    <span class="${isHidden ? 'line-through' : ''}">${m.shortName}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Chart Area -->
          <div class="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
            ${history.length > 0 ? `
              <div class="h-80 sm:h-96 relative w-full">
                <canvas id="canvas-combined-metrics"></canvas>
              </div>
            ` : `
              <div class="h-48 flex flex-col items-center justify-center text-slate-400 text-xs">
                <i data-lucide="line-chart" class="w-8 h-8 mb-2 opacity-40"></i>
                <span>אין נתוני שקילה להצגה בתרשים המשולב עדיין. הזן שקילה חדשה כדי להציג את הגרף.</span>
              </div>
            `}
          </div>

          <!-- Bottom Collapse Button -->
          <div class="pt-3 border-t border-slate-800/80 flex justify-center">
            <button
              type="button"
              data-collapse-card="tanita-combined-chart-acc"
              class="px-5 py-2 rounded-xl bg-slate-800/95 hover:bg-slate-700 border border-slate-700/80 text-xs font-bold text-slate-200 hover:text-indigo-300 flex items-center gap-2 transition-all cursor-pointer shadow-md min-h-[40px] active:scale-95"
            >
              <i data-lucide="chevron-up" class="w-4 h-4 text-indigo-400"></i>
              <span>כווץ תרשים משולב חזרה למעלה ▲</span>
            </button>
          </div>
        </div>
      </details>
    `;
  }

  // --- TANITA VIEW WITH INTELLIGENT SMART PASTE PARSER & VISCERAL FAT HIGHLIGHT ---
  getTanitaHTML() {
    const user = state.activeUser;
    const history = getTanitaHistory(user);
    const trends = calculateTanitaTrends(history);
    const profile = state.getCurrentProfile();
    const latestTanita = getLatestTanitaEntry(user);
    const draft = this.smartPasteDraft;

    // Derived BMI fallback if not in Tanita
    const fallbackBmi = profile.currentWeight && profile.heightCm
      ? (profile.currentWeight / Math.pow(profile.heightCm / 100, 2)).toFixed(1)
      : null;

    return `
      <div class="space-y-6">
        <!-- Header Banner -->
        <div class="dashboard-card flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                טניטה (Tanita Body Composition)
              </span>
              <span class="text-xs text-slate-400">פרופיל פעיל: <strong>${profile.hebrewName}</strong></span>
            </div>
            <h2 class="text-xl font-extrabold text-slate-100 mb-1">הרכב גוף מלא (11 מדדי My Tanita) ומעקב מגמות</h2>
            <p class="text-xs text-slate-400">
              יעדים מוגדרים: משקל <strong>${profile.targetWeight} ק"ג</strong> | שומן ויסצראלי <strong>≤${profile.targetVisceralFat}</strong> | אחוז שומן <strong>${profile.targetBodyFat}%</strong>
            </p>
          </div>
          <button id="tanita-edit-profile-btn" class="btn-secondary text-xs flex items-center gap-1.5 cursor-pointer">
            <i data-lucide="sliders" class="w-3.5 h-3.5 text-cyan-400"></i> ערוך יעדי גוף
          </button>
        </div>

        <!-- Visceral Fat Highlight Card -->
        <div class="visceral-highlight-card p-5 ${latestTanita && latestTanita.visceralFat <= profile.targetVisceralFat ? 'visceral-target-met' : ''}">
          <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-black px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase tracking-wide">
                  מדד מפתח בריאותי
                </span>
                <span class="text-xs text-slate-300 font-bold">שומן ויסצראלי (Visceral Fat)</span>
              </div>
              <h3 class="text-lg font-bold text-slate-100">
                ${latestTanita ? `רמה נוכחית: <span class="text-2xl font-black text-amber-400">${latestTanita.visceralFat}</span> (יעד רצוי: ≤${profile.targetVisceralFat})` : `יעד שומן ויסצראלי מוגדר: ≤${profile.targetVisceralFat}`}
              </h3>
              <p class="text-xs text-slate-300 leading-relaxed max-w-2xl">
                ${latestTanita ? (
                  latestTanita.visceralFat <= profile.targetVisceralFat
                    ? '✅ מעולה! השומן התוך-בטני שלך נמצא בטווח היעד הבריא. שמור על המאקרו והאימונים.'
                    : latestTanita.visceralFat <= 6
                      ? '⚠️ רמה גבולית. שילוב הגירעון המחושב (-' + (profile.deficitKcal || 600) + ' kcal) וצריכת חלבון מספקת יאיץ את ירידת השומן הבטני.'
                      : '🚨 רמה מוגברת. מומלץ להקפיד על יעדי המאקרו האוטומטיים ופעילות אירובית לשריפת שומן עמוק.'
                ) : 'הדבק מדידה מאפליקציית My Tanita כדי לעקוב אחר התקדמות השומן הויסצראלי.'}
              </p>
            </div>

            <!-- BMR & TDEE Derivation Box -->
            <div class="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 text-center min-w-[200px] shrink-0 self-stretch md:self-auto">
              <div class="text-[11px] text-slate-400">BMR מדוד (חילוף חומרים)</div>
              <div class="text-xl font-black text-cyan-400">
                ${latestTanita && latestTanita.bmr ? `${latestTanita.bmr} kcal` : `${profile.measuredBmr || 1650} kcal`}
              </div>
              <div class="text-[10px] text-slate-500 mt-0.5">
                תחזוקה TDEE: <strong>${Math.round((latestTanita && latestTanita.bmr ? latestTanita.bmr : (profile.measuredBmr || 1650)) * 1.35)} kcal</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- 11-Metric Card Grid (Full Tanita Support) -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-slate-200 flex items-center gap-2">
              <i data-lucide="layout-grid" class="w-4 h-4 text-cyan-400"></i>
              <span>לוח 11 המדדים (My Tanita Diagnostics)</span>
            </h3>
            <span class="text-[11px] text-slate-400">
              ${latestTanita ? `מדידה אחרונה: ${latestTanita.date}` : 'ללא נתונים'}
            </span>
          </div>

          <div class="metric-card-grid">
            <!-- 1. Weight -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">1. משקל</span>
                <span class="text-sm">⚖️</span>
              </div>
              <div class="text-xl font-black text-slate-100">
                ${latestTanita?.weight ? `${latestTanita.weight} <span class="text-xs font-normal text-slate-400">ק"ג</span>` : `${profile.currentWeight || '-'} ק"ג`}
              </div>
              <div class="text-[10px] text-slate-400">יעד: <strong class="text-emerald-400">${profile.targetWeight} ק"ג</strong></div>
            </div>

            <!-- 2. BMI -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">2. BMI</span>
                <span class="text-sm">📐</span>
              </div>
              <div class="text-xl font-black text-slate-100">
                ${latestTanita?.bmi || fallbackBmi || '-'}
              </div>
              <div class="text-[10px] text-slate-400">טווח תקין: 18.5 - 24.9</div>
            </div>

            <!-- 3. Body Fat -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">3. אחוז שומן</span>
                <span class="text-sm">📉</span>
              </div>
              <div class="text-xl font-black text-emerald-400">
                ${latestTanita?.bodyFat ? `${latestTanita.bodyFat}%` : '-'}
              </div>
              <div class="text-[10px] text-slate-400">יעד: <strong class="text-emerald-400">${profile.targetBodyFat}%</strong></div>
            </div>

            <!-- 4. Muscle Mass -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">4. מסת שריר</span>
                <span class="text-sm">💪</span>
              </div>
              <div class="text-xl font-black text-blue-400">
                ${latestTanita?.muscleKg ? `${latestTanita.muscleKg} <span class="text-xs font-normal text-slate-400">ק"ג</span>` : '-'}
              </div>
              <div class="text-[10px] text-slate-400">מסת גוף רזה</div>
            </div>

            <!-- 5. Bone Mass -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">5. מסת עצם</span>
                <span class="text-sm">🦴</span>
              </div>
              <div class="text-xl font-black text-slate-200">
                ${latestTanita?.boneMass ? `${latestTanita.boneMass} <span class="text-xs font-normal text-slate-400">ק"ג</span>` : '-'}
              </div>
              <div class="text-[10px] text-slate-400">מינרל עצם משוער</div>
            </div>

            <!-- 6. BMR -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">6. חילוף חומרים (BMR)</span>
                <span class="text-sm">⚡</span>
              </div>
              <div class="text-xl font-black text-cyan-400">
                ${latestTanita?.bmr ? `${latestTanita.bmr} <span class="text-xs font-normal text-slate-400">kcal</span>` : `${profile.measuredBmr || 1650} kcal`}
              </div>
              <div class="text-[10px] text-slate-400">שריפה במנוחה</div>
            </div>

            <!-- 7. Body Water -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">7. נוזלים בגוף</span>
                <span class="text-sm">💧</span>
              </div>
              <div class="text-xl font-black text-sky-400">
                ${latestTanita?.waterPct ? `${latestTanita.waterPct}%` : '-'}
              </div>
              <div class="text-[10px] text-slate-400">רמה בריאה: 50% - 65%</div>
            </div>

            <!-- 8. Metabolic Age -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">8. גיל מטבולי</span>
                <span class="text-sm">🎂</span>
              </div>
              <div class="text-xl font-black text-purple-300">
                ${latestTanita?.metabolicAge ? `${latestTanita.metabolicAge} <span class="text-xs font-normal text-slate-400">שנים</span>` : '-'}
              </div>
              <div class="text-[10px] text-slate-400">גיל פיזיולוגי מחושב</div>
            </div>

            <!-- 9. Visceral Fat (HIGHLIGHTED) -->
            <div class="tanita-metric-tile visceral-tile-highlight">
              <div class="flex justify-between items-start">
                <span class="text-xs text-amber-300 font-extrabold">9. שומן ויסצראלי ⭐</span>
                <span class="text-sm">⚠️</span>
              </div>
              <div class="text-2xl font-black text-amber-400">
                ${latestTanita?.visceralFat ?? '-'}
              </div>
              <div class="text-[10px] font-bold text-amber-300/90">יעד בריאותי: ≤${profile.targetVisceralFat} (טווח 1-15)</div>
            </div>

            <!-- 10. Muscle Quality -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">10. איכות שריר</span>
                <span class="text-sm">🎖️</span>
              </div>
              <div class="text-xl font-black text-indigo-300">
                ${latestTanita?.muscleQuality ? `${latestTanita.muscleQuality} <span class="text-xs font-normal text-slate-400">mq</span>` : '-'}
              </div>
              <div class="text-[10px] text-slate-400">ציון איכות צפיפות</div>
            </div>

            <!-- 11. Body Type -->
            <div class="tanita-metric-tile">
              <div class="flex justify-between items-start">
                <span class="text-xs text-slate-400 font-semibold">11. מבנה גוף</span>
                <span class="text-sm">🏃</span>
              </div>
              <div class="text-base font-black text-emerald-300 leading-tight">
                ${latestTanita?.bodyType ? (BODY_TYPE_LABELS[latestTanita.bodyType] || `סוג ${latestTanita.bodyType}`) : '-'}
              </div>
              <div class="text-[10px] text-slate-400">
                ${latestTanita?.bodyType ? `דירוג Tanita: ${latestTanita.bodyType}/9` : 'פרופיל מבנה 1-9'}
              </div>
            </div>
          </div>
        </div>

        <!-- Visual Progress & Trend Charts Container (Collapsible Accordion with 11 Individual Metric Charts + Flagship Charts) -->
        <details id="tanita-charts-acc" class="accordion-card dashboard-card group p-0 overflow-hidden" ${this.isAccordionOpen('tanita_charts', true) ? 'open' : ''}>
          <summary class="cursor-pointer list-none flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 sm:p-5 select-none border-b border-slate-800/80 bg-slate-900/30 hover:bg-slate-800/30 transition-colors">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                <i data-lucide="trending-up" class="w-5 h-5"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-sm sm:text-base font-extrabold text-slate-100">גרפי מגמות והתקדמות הרכב גוף</h3>
                  <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">11 מדדים</span>
                </div>
                <p class="text-xs text-slate-400 mt-0.5">מעקב חזותי מלא עם גרף ייעודי לכל אחד מ-11 מדדי הטניטה, שינוי מצטבר וטווחי זמן</p>
              </div>
            </div>
            <div class="flex items-center gap-2 self-end sm:self-center">
              <div class="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/80 text-xs font-bold text-slate-200 hover:text-emerald-300 flex items-center gap-2 transition-all shadow-sm shrink-0 min-h-[38px]">
                <span>כיווץ / הרחבה</span>
                <i data-lucide="chevron-down" class="w-4 h-4 text-emerald-400 transition-transform duration-200 accordion-chevron"></i>
              </div>
            </div>
          </summary>

          <div class="p-4 sm:p-5 space-y-4">
            <!-- Top Controls Bar: Timeframe & View Mode -->
            <div class="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 pb-3 border-b border-slate-800/80">
              <!-- View Mode Toggle: All 11 Metrics vs Flagship Dual-Axis vs Single Focused Metric -->
              <div class="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
                <span class="text-xs font-bold text-slate-400 shrink-0">מצב תצוגה:</span>
                <button type="button" data-tanita-view="all_11" class="chart-view-btn text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${this.chartViewMode === 'all_11' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'}">
                  📊 כל 11 המדדים (גרף לכל מדד)
                </button>
                <button type="button" data-tanita-view="both" class="chart-view-btn text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${this.chartViewMode === 'both' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'}">
                  ⚖️ שני גרפי הדגל (ציר כפול)
                </button>
                <button type="button" data-tanita-view="single" class="chart-view-btn text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${this.chartViewMode === 'single' ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm' : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'}">
                  🎯 גרף ממוקד לפי מדד
                </button>
              </div>

              <!-- Timeframe Filter Buttons: 7 ימים, 30 ימים, 90 ימים, הכל -->
              <div class="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 shrink-0">
                <span class="text-[11px] text-slate-400 px-1.5 hidden sm:inline">טווח:</span>
                <button type="button" data-tanita-timeframe="7" class="timeframe-btn px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${this.chartTimeframe === '7' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}">
                  7 ימים
                </button>
                <button type="button" data-tanita-timeframe="30" class="timeframe-btn px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${this.chartTimeframe === '30' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}">
                  30 ימים
                </button>
                <button type="button" data-tanita-timeframe="90" class="timeframe-btn px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${this.chartTimeframe === '90' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}">
                  90 ימים
                </button>
                <button type="button" data-tanita-timeframe="all" class="timeframe-btn px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${this.chartTimeframe === 'all' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}">
                  הכל
                </button>
              </div>
            </div>

            <!-- VIEW 1: ALL 11 METRICS GRID -->
            ${this.chartViewMode === 'all_11' ? `
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                ${TANITA_METRIC_CONFIGS.map(m => {
                  const val = latestTanita ? (latestTanita[m.key] !== undefined && latestTanita[m.key] !== null ? latestTanita[m.key] : '-') : '-';
                  let deltaBadge = '';
                  if (history.length >= 2 && latestTanita && latestTanita[m.key] !== undefined && latestTanita[m.key] !== null) {
                    const earliest = history[history.length - 1];
                    if (earliest && earliest[m.key] !== undefined && earliest[m.key] !== null) {
                      const diff = Number((latestTanita[m.key] - earliest[m.key]).toFixed(1));
                      if (diff > 0) {
                        const isGood = !m.lowerIsBetter;
                        deltaBadge = `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${isGood ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}">▲ +${diff}</span>`;
                      } else if (diff < 0) {
                        const isGood = m.lowerIsBetter;
                        deltaBadge = `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${isGood ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}">▼ ${diff}</span>`;
                      } else {
                        deltaBadge = `<span class="text-[10px] text-slate-400">ללא שינוי</span>`;
                      }
                    }
                  }
                  return `
                    <div class="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 space-y-2 flex flex-col justify-between hover:border-slate-700 transition-all">
                      <div class="flex justify-between items-start">
                        <div class="flex items-center gap-2">
                          <span class="w-3 h-3 rounded-full shrink-0" style="background-color: ${m.color}"></span>
                          <div>
                            <div class="flex items-center gap-1.5">
                              <span class="text-xs font-bold text-slate-200">${m.name}</span>
                              <button type="button" data-tanita-info="${m.key}" class="w-4 h-4 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-emerald-400 border border-slate-700/60 flex items-center justify-center text-[10px] font-black transition-colors cursor-pointer shrink-0" title="מידע על ${m.name}">
                                ?
                              </button>
                            </div>
                            <div class="text-[10px] text-slate-400">${m.desc}</div>
                          </div>
                        </div>
                        <div class="text-left shrink-0">
                          <div class="text-sm font-black text-slate-100">${val} <span class="text-[10px] text-slate-400 font-normal">${m.unit}</span></div>
                          ${deltaBadge}
                        </div>
                      </div>
                      <div class="h-40 relative w-full mt-1">
                        <canvas id="canvas-metric-${m.key}"></canvas>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}

            <!-- VIEW 2: SINGLE METRIC FOCUSED VIEW -->
            ${this.chartViewMode === 'single' ? `
              <div class="space-y-3">
                <!-- Pills selector for the 11 metrics -->
                <div class="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-800/60">
                  ${TANITA_METRIC_CONFIGS.map(m => {
                    const isSelected = (this.selectedSingleMetric || 'weight') === m.key;
                    return `
                      <button
                        type="button"
                        data-select-single-metric="${m.key}"
                        class="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer border flex items-center gap-1.5 ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300 ring-2 ring-emerald-500/30'
                            : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }"
                      >
                        <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${m.color}"></span>
                        <span>${m.name}</span>
                      </button>
                    `;
                  }).join('')}
                </div>

                <!-- Focused Metric Card -->
                ${(() => {
                  const m = TANITA_METRIC_CONFIGS.find(cfg => cfg.key === (this.selectedSingleMetric || 'weight')) || TANITA_METRIC_CONFIGS[0];
                  const val = latestTanita ? (latestTanita[m.key] !== undefined && latestTanita[m.key] !== null ? latestTanita[m.key] : '-') : '-';
                  return `
                    <div class="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
                      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-800">
                        <div class="flex items-center gap-2.5">
                          <span class="w-4 h-4 rounded-full shrink-0" style="background-color: ${m.color}"></span>
                          <div>
                            <div class="flex items-center gap-2">
                              <h4 class="text-sm font-bold text-slate-100">${m.name} (${m.unit})</h4>
                              <button type="button" data-tanita-info="${m.key}" class="w-4 h-4 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-emerald-400 border border-slate-700/60 flex items-center justify-center text-[10px] font-black transition-colors cursor-pointer shrink-0" title="מידע על ${m.name}">
                                ?
                              </button>
                            </div>
                            <p class="text-xs text-slate-400">${m.desc} | שינוי מבוקש: ${m.lowerIsBetter ? 'ירידה רצויה' : 'עלייה/יציבות רצויה'}</p>
                          </div>
                        </div>
                        <div class="text-left">
                          <div class="text-xl font-black text-slate-100">${val} <span class="text-xs text-slate-400">${m.unit}</span></div>
                        </div>
                      </div>
                      <div class="h-64 relative w-full">
                        <canvas id="canvas-single-metric"></canvas>
                      </div>
                    </div>
                  `;
                })()}
              </div>
            ` : ''}

            <!-- VIEW 3: DUAL-AXIS FLAGSHIP CHARTS (Weight & Muscle + Visceral & Fat %) -->
            ${this.chartViewMode === 'both' ? `
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <!-- Chart 1: Weight & Muscle Mass (Dual-Axis) -->
                <div id="chart-card-weight-muscle" class="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 space-y-2">
                  <div class="flex justify-between items-center pb-2 border-b border-slate-800">
                    <h4 class="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                      <span>משקל ומסת שריר (ציר שמאל: משקל | ציר ימין: שריר)</span>
                    </h4>
                    <div class="flex items-center gap-1">
                      <button type="button" data-tanita-info="weight" class="w-4 h-4 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-emerald-400 border border-slate-700/60 flex items-center justify-center text-[9px] font-black transition-colors cursor-pointer" title="מידע על משקל">?</button>
                      <button type="button" data-tanita-info="muscleKg" class="w-4 h-4 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-blue-400 border border-slate-700/60 flex items-center justify-center text-[9px] font-black transition-colors cursor-pointer" title="מידע על מסת שריר">?</button>
                      <span class="text-[10px] text-slate-400 mr-1">ק"ג</span>
                    </div>
                  </div>
                  <div class="h-60 relative w-full">
                    <canvas id="canvas-weight-muscle"></canvas>
                  </div>
                </div>

                <!-- Chart 2: Visceral Fat & Body Fat % (Dual-Axis) -->
                <div id="chart-card-visceral-fat" class="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 space-y-2">
                  <div class="flex justify-between items-center pb-2 border-b border-slate-800">
                    <h4 class="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                      <span>שומן ויסצראלי מול אחוז שומן (ציר כפול)</span>
                    </h4>
                    <div class="flex items-center gap-1">
                      <button type="button" data-tanita-info="visceralFat" class="w-4 h-4 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-amber-400 border border-slate-700/60 flex items-center justify-center text-[9px] font-black transition-colors cursor-pointer" title="מידע על שומן ויסצראלי">?</button>
                      <button type="button" data-tanita-info="bodyFat" class="w-4 h-4 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-pink-400 border border-slate-700/60 flex items-center justify-center text-[9px] font-black transition-colors cursor-pointer" title="מידע על אחוז שומן">?</button>
                      <span class="text-[10px] text-slate-400 mr-1">רמה / %</span>
                    </div>
                  </div>
                  <div class="h-60 relative w-full">
                    <canvas id="canvas-visceral-fat"></canvas>
                  </div>
                </div>
              </div>
            ` : ''}

            <!-- Bottom Chart: Macro & Calorie Compliance (Past 7 Days) -->
            <div class="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 space-y-2">
              <div class="flex justify-between items-center pb-2 border-b border-slate-800">
                <h4 class="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                  <span class="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                  <span>עמידה ביעדי קלוריות וחלבון יומיים (7 הימים האחרונים)</span>
                </h4>
                <span class="text-[10px] text-slate-400">יעד קלוריות: ${profile.targetKcal} | יעד חלבון: ${profile.targetProtein}g</span>
              </div>
              <div class="h-52 relative w-full">
                <canvas id="canvas-macro-compliance"></canvas>
              </div>
            </div>

            <!-- Bottom Collapse Button for Charts -->
            <div class="pt-3 border-t border-slate-800/80 flex justify-center">
              <button
                type="button"
                data-collapse-card="tanita-charts-acc"
                class="px-5 py-2 rounded-xl bg-slate-800/95 hover:bg-slate-700 border border-slate-700/80 text-xs font-bold text-slate-200 hover:text-emerald-300 flex items-center gap-2 transition-all cursor-pointer shadow-md min-h-[40px] active:scale-95"
              >
                <i data-lucide="chevron-up" class="w-4 h-4 text-emerald-400"></i>
                <span>כווץ גרפי מגמות חזרה למעלה ▲</span>
              </button>
            </div>
          </div>
        </details>

        <!-- Combined Multi-Metric Tanita Chart (Separate Collapsible Card) -->
        ${this.renderCardCombinedTanitaChart(history)}

        <!-- 1. Tanita Smart Paste Parser Card (All 11 Metrics) -->
        <div class="dashboard-card border-cyan-500/30 space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold">
                <i data-lucide="sparkles" class="w-4 h-4"></i>
              </div>
              <div>
                <h3 class="text-sm font-bold text-slate-100">הדבקה חכמה מאפליקציית My Tanita (Smart Paste)</h3>
                <p class="text-xs text-slate-400">העתק את טקסט השיתוף מאפליקציית My Tanita והדבק כאן. המערכת תזהה את כל 11 המדדים מיד.</p>
              </div>
            </div>
            <button id="btn-insert-sample-tanita" type="button" class="text-xs text-cyan-400 hover:text-cyan-300 underline cursor-pointer">
              הדבק טקסט לדוגמה (11 מדדים)
            </button>
          </div>

          <!-- Textarea -->
          <div class="space-y-2">
            <textarea
              id="tanita-smart-paste-text"
              rows="3"
              placeholder="הדבק כאן את הטקסט הגולמי מ-My Tanita... לדוגמה:&#10;• Weight: 70.2 kg • BMI: 23.2 • Body fat: 15.6 % • Muscle mass: 56.40 kg • Bone mass: 3.10 kg • BMR: 1,685 kcal • Body water: 55.2 % • Metabolic age: 28 • Visceral fat: 5.0 • Muscle quality: 68 • Body type: 6"
              class="smart-paste-area"
            ></textarea>
          </div>

          <!-- Detected Metrics Preview -->
          <div id="smart-paste-detected-container" class="${draft ? '' : 'hidden'} space-y-2 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
            <div class="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
              <span>מדדים שזוהו בטקסט:</span>
            </div>
            <div id="smart-paste-badges" class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
              <!-- Dynamically populated -->
            </div>
          </div>

          <!-- Actions -->
          <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            <div class="flex items-center gap-2 text-xs">
              <span class="text-slate-400">תאריך המדידה:</span>
              <input type="date" id="smart-paste-date" value="${new Date().toISOString().split('T')[0]}" class="input-field py-1.5 px-3 text-xs w-auto cursor-pointer" />
            </div>

            <button id="btn-parse-and-save-tanita" class="btn-primary text-xs font-bold py-2.5 px-6 w-full sm:w-auto flex items-center justify-center gap-2 shadow-md cursor-pointer">
              <i data-lucide="check" class="w-4 h-4"></i>
              <span>שמור מדידה ליומן טניטה</span>
            </button>
          </div>
          <div id="tanita-paste-alert" class="hidden p-2.5 rounded-xl text-xs font-bold text-center"></div>
        </div>

        <!-- Trends Grid -->
        ${history.length >= 2 ? `
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="dashboard-card">
              <div class="text-xs text-slate-400">שינוי משקל</div>
              <div class="text-lg font-extrabold ${trends.weightDiff <= 0 ? 'text-emerald-400' : 'text-red-400'}">
                ${trends.weightDiff > 0 ? '+' : ''}${trends.weightDiff} ק"ג
              </div>
            </div>
            <div class="dashboard-card">
              <div class="text-xs text-slate-400">שינוי אחוז שומן</div>
              <div class="text-lg font-extrabold ${trends.fatDiff <= 0 ? 'text-emerald-400' : 'text-red-400'}">
                ${trends.fatDiff > 0 ? '+' : ''}${trends.fatDiff}%
              </div>
            </div>
            <div class="dashboard-card border-amber-500/30">
              <div class="text-xs text-slate-400 font-semibold">שומן ויסצראלי</div>
              <div class="text-lg font-extrabold ${trends.visceralDiff <= 0 ? 'text-emerald-400' : 'text-amber-400'}">
                ${trends.visceralDiff > 0 ? '+' : ''}${trends.visceralDiff}
              </div>
            </div>
            <div class="dashboard-card">
              <div class="text-xs text-slate-400">מסת שריר</div>
              <div class="text-lg font-extrabold text-blue-400">
                ${trends.muscleDiff > 0 ? '+' : ''}${trends.muscleDiff} ק"ג
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Manual Entry Accordion (All 11 Metrics) -->
        <details id="tanita-manual-acc" class="accordion-card dashboard-card group" ${this.isAccordionOpen('tanita_manual', false) ? 'open' : ''}>
          <summary class="cursor-pointer list-none flex items-center justify-between select-none pb-2 border-b border-slate-800/70">
            <span class="flex items-center gap-2 text-sm font-bold text-slate-200">
              <i data-lucide="edit-3" class="w-4 h-4 text-cyan-400"></i>
              <span>הזנה ידנית (11 מדדים מלאים)</span>
            </span>
            <div class="px-3.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/80 text-xs font-bold text-slate-300 hover:text-cyan-300 flex items-center gap-2 transition-all shadow-sm shrink-0 min-h-[38px]">
              <span>כיווץ / הרחבה</span>
              <i data-lucide="chevron-down" class="w-4 h-4 text-cyan-400 transition-transform duration-200 accordion-chevron"></i>
            </div>
          </summary>
          <form id="tanita-form" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-slate-800 mt-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">תאריך מדידה</label>
              <input type="date" id="tanita-date" required value="${new Date().toISOString().split('T')[0]}" class="input-field text-xs font-bold" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">1. משקל (ק"ג)</label>
              <input type="number" step="any" id="tanita-weight" required placeholder="${profile.currentWeight || 70}" class="input-field text-xs font-bold" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">2. מדד BMI</label>
              <input type="number" step="any" id="tanita-bmi" placeholder="${fallbackBmi || 23.5}" class="input-field text-xs" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">3. אחוז שומן (%)</label>
              <input type="number" step="any" id="tanita-fat" required placeholder="${profile.targetBodyFat || 18.5}" class="input-field text-xs" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">4. מסת שריר (ק"ג)</label>
              <input type="number" step="any" id="tanita-muscle" required placeholder="54.0" class="input-field text-xs font-bold text-blue-400" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">5. מסת עצם (ק"ג)</label>
              <input type="number" step="any" id="tanita-bone" placeholder="3.0" class="input-field text-xs" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">6. חילוף חומרים BMR (kcal)</label>
              <input type="number" step="any" id="tanita-bmr" placeholder="${profile.measuredBmr || 1650}" class="input-field text-xs" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">7. אחוז נוזלים (%)</label>
              <input type="number" step="any" id="tanita-water" placeholder="55.0" class="input-field text-xs" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">8. גיל מטבולי (שנים)</label>
              <input type="number" step="any" id="tanita-metabolic-age" placeholder="30" class="input-field text-xs" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1 font-bold text-amber-300">9. שומן ויסצרלי ⭐ (רמה 1-15)</label>
              <input type="number" step="any" id="tanita-visceral" required placeholder="${profile.targetVisceralFat || 4}" class="input-field text-xs text-amber-400 font-bold border-amber-500/40" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">10. איכות שריר (mq)</label>
              <input type="number" step="any" id="tanita-muscle-quality" placeholder="70" class="input-field text-xs" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">11. מבנה גוף (1-9)</label>
              <select id="tanita-body-type" class="input-field text-xs cursor-pointer">
                <option value="">בחר מבנה גוף...</option>
                ${Object.entries(BODY_TYPE_LABELS).map(([k, label]) => `
                  <option value="${k}">${k} - ${label}</option>
                `).join('')}
              </select>
            </div>
            <div class="sm:col-span-2 lg:col-span-4 flex flex-col sm:flex-row items-center justify-between gap-2 pt-2">
              <button
                type="button"
                data-collapse-card="tanita-manual-acc"
                class="px-4 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700/70 text-xs font-bold text-slate-300 hover:text-cyan-300 flex items-center gap-1.5 transition-all cursor-pointer min-h-[38px] active:scale-95"
              >
                <i data-lucide="chevron-up" class="w-4 h-4 text-cyan-400"></i>
                <span>כווץ טופס ▲</span>
              </button>
              <button type="submit" class="btn-primary text-xs w-full sm:w-auto py-2.5 px-5 font-bold">שמור 11 מדדים ליומן</button>
            </div>
          </form>
        </details>

        <!-- History Table (Collapsible Accordion with All 11 Metrics, Horizontal Scroll, Sticky Date Column & Visceral Fat Highlighting) -->
        <details id="tanita-table-acc" class="accordion-card dashboard-card group p-0 overflow-hidden" ${this.isAccordionOpen('tanita_table', true) ? 'open' : ''}>
          <summary class="cursor-pointer list-none flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 sm:p-5 select-none border-b border-slate-800/80 bg-slate-900/30 hover:bg-slate-800/30 transition-colors">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0">
                <i data-lucide="table-2" class="w-5 h-5"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-sm sm:text-base font-extrabold text-slate-100">היסטוריית שקילות ומדדים (טבלה מלאה)</h3>
                  <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">${history.length} מדידות</span>
                </div>
                <p class="text-xs text-slate-400 mt-0.5">כל 11 המדדים מרוכזים בטבלה מלאה עם עמודת תאריך מקובעת</p>
              </div>
            </div>
            <div class="flex items-center gap-2 self-end sm:self-center">
              <div class="px-4 py-2 rounded-xl bg-slate-800/95 hover:bg-slate-700/90 border border-slate-700/80 text-xs font-bold text-slate-200 hover:text-blue-300 flex items-center gap-2 transition-all shadow-sm shrink-0 min-h-[40px]">
                <span>כיווץ / הרחבה</span>
                <i data-lucide="chevron-down" class="w-4 h-4 text-blue-400 transition-transform duration-200 accordion-chevron"></i>
              </div>
            </div>
          </summary>

          <div class="p-4 sm:p-5 space-y-3">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <p class="text-xs text-slate-400">גלול אופקית לצפייה בכל הנתונים. לחץ על מחיקה להסרת רשומה.</p>
              ${history.length > 0 ? `
                <button id="btn-clear-all-tanita" class="text-xs text-red-400 hover:text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  <span>מחק את כל היסטוריית הטניטה</span>
                </button>
              ` : ''}
            </div>
            ${history.length > 0 ? `
              <div class="overflow-x-auto rounded-xl border border-slate-800">
                <table class="w-full text-right text-xs">
                  <thead>
                    <tr class="border-b border-slate-800 text-slate-400 bg-slate-950/80">
                      <th class="py-2.5 px-3 tanita-table-sticky-col whitespace-nowrap">תאריך</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">משקל</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">BMI</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">% שומן</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">מסת שריר</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">מסת עצם</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">BMR</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">% נוזלים</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">גיל מטבולי</th>
                      <th class="py-2.5 px-3 tanita-visceral-col text-amber-300 font-bold whitespace-nowrap">שומן ויסצרלי ⭐</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">איכות שריר</th>
                      <th class="py-2.5 px-3 whitespace-nowrap">מבנה גוף</th>
                      <th class="py-2.5 px-3 text-left whitespace-nowrap">פעולות</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800/60">
                    ${history.map(item => `
                      <tr class="hover:bg-slate-900/40">
                        <td class="py-3 px-3 font-medium text-slate-200 whitespace-nowrap tanita-table-sticky-col">${item.date}</td>
                        <td class="py-3 px-3 font-bold text-slate-100 whitespace-nowrap">${item.weight} ק"ג</td>
                        <td class="py-3 px-3 text-slate-300 whitespace-nowrap">${item.bmi || '-'}</td>
                        <td class="py-3 px-3 text-emerald-400 whitespace-nowrap">${item.bodyFat}%</td>
                        <td class="py-3 px-3 text-blue-400 whitespace-nowrap">${item.muscleKg} ק"ג</td>
                        <td class="py-3 px-3 text-slate-300 whitespace-nowrap">${item.boneMass ? item.boneMass + ' ק"ג' : '-'}</td>
                        <td class="py-3 px-3 text-cyan-400 whitespace-nowrap">${item.bmr || '-'}</td>
                        <td class="py-3 px-3 text-sky-300 whitespace-nowrap">${item.waterPct ? item.waterPct + '%' : '-'}</td>
                        <td class="py-3 px-3 text-purple-300 whitespace-nowrap">${item.metabolicAge || '-'}</td>
                        <td class="py-3 px-3 tanita-visceral-col font-black text-amber-400 text-center whitespace-nowrap">${item.visceralFat ?? '-'}</td>
                        <td class="py-3 px-3 text-indigo-300 whitespace-nowrap">${item.muscleQuality ? item.muscleQuality + ' mq' : '-'}</td>
                        <td class="py-3 px-3 text-slate-300 whitespace-nowrap">${item.bodyType ? (BODY_TYPE_LABELS[item.bodyType] || item.bodyType) : '-'}</td>
                        <td class="py-3 px-3 text-left whitespace-nowrap">
                          <button data-delete-tanita="${item.id}" aria-label="מחק מדידה" class="delete-tanita-btn text-slate-400 hover:text-red-400 p-1 transition-colors cursor-pointer min-h-[36px] min-w-[36px] inline-flex items-center justify-center">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : `
              <div class="text-center py-8 text-slate-400 text-sm">אין עדיין מדידות טניטה בהיסטוריה.</div>
            `}

            <!-- Bottom Collapse Button at the end of Tanita table -->
            <div class="pt-4 mt-3 border-t border-slate-800/80 flex justify-center pb-1">
              <button
                type="button"
                data-collapse-card="tanita-table-acc"
                class="px-6 py-2.5 rounded-xl bg-slate-800/95 hover:bg-slate-700 border border-slate-700/80 text-xs font-bold text-slate-200 hover:text-blue-300 flex items-center gap-2 transition-all cursor-pointer shadow-lg min-h-[44px] active:scale-95"
              >
                <i data-lucide="chevron-up" class="w-4 h-4 text-blue-400"></i>
                <span>כווץ טבלה זו חזרה למעלה ▲</span>
              </button>
            </div>
          </div>
        </details>

        <!-- Scroll Clearance Spacer -->
        <div class="h-20 sm:h-24 w-full shrink-0"></div>
      </div>
    `;
  }

  bindTanitaEvents() {
    const editBtn = document.getElementById('tanita-edit-profile-btn');
    if (editBtn) {
      editBtn.addEventListener('click', () => this.openProfileModal());
    }

    const pasteArea = document.getElementById('tanita-smart-paste-text');
    const previewContainer = document.getElementById('smart-paste-detected-container');
    const badgesContainer = document.getElementById('smart-paste-badges');
    const sampleBtn = document.getElementById('btn-insert-sample-tanita');
    const parseAndSaveBtn = document.getElementById('btn-parse-and-save-tanita');
    const alertBox = document.getElementById('tanita-paste-alert');

    const updateDetectionUI = (text) => {
      const parsed = parseTanitaText(text);
      this.smartPasteDraft = parsed;

      if (!parsed) {
        if (previewContainer) previewContainer.classList.add('hidden');
        return;
      }

      if (previewContainer && badgesContainer) {
        previewContainer.classList.remove('hidden');
        const items = [];
        if (parsed.weight !== null) items.push({ label: '1. משקל', val: `${parsed.weight} ק"ג`, color: 'text-slate-100 font-bold' });
        if (parsed.bmi !== null) items.push({ label: '2. BMI', val: `${parsed.bmi}`, color: 'text-slate-200' });
        if (parsed.bodyFat !== null) items.push({ label: '3. שומן', val: `${parsed.bodyFat}%`, color: 'text-emerald-400 font-bold' });
        if (parsed.muscleKg !== null) items.push({ label: '4. מסת שריר', val: `${parsed.muscleKg} ק"ג`, color: 'text-blue-400 font-bold' });
        if (parsed.boneMass !== null) items.push({ label: '5. מסת עצם', val: `${parsed.boneMass} ק"ג`, color: 'text-slate-300' });
        if (parsed.bmr !== null) items.push({ label: '6. BMR', val: `${parsed.bmr} kcal`, color: 'text-cyan-400' });
        if (parsed.waterPct !== null) items.push({ label: '7. נוזלים', val: `${parsed.waterPct}%`, color: 'text-sky-300' });
        if (parsed.metabolicAge !== null) items.push({ label: '8. גיל מטבולי', val: `${parsed.metabolicAge}`, color: 'text-purple-300' });
        if (parsed.visceralFat !== null) items.push({ label: '9. שומן ויסצראלי ⭐', val: `${parsed.visceralFat}`, color: 'text-amber-400 font-black' });
        if (parsed.muscleQuality !== null) items.push({ label: '10. איכות שריר', val: `${parsed.muscleQuality} mq`, color: 'text-indigo-300' });
        if (parsed.bodyType !== null) items.push({ label: '11. מבנה גוף', val: `${BODY_TYPE_LABELS[parsed.bodyType] || parsed.bodyType}`, color: 'text-emerald-300' });

        badgesContainer.innerHTML = items.map(it => `
          <div class="bg-slate-900/90 p-2 rounded-lg border border-slate-800">
            <div class="text-[10px] text-slate-400">${it.label}</div>
            <div class="text-xs ${it.color}">${it.val}</div>
          </div>
        `).join('');
      }
    };

    if (pasteArea) {
      pasteArea.addEventListener('input', (e) => {
        updateDetectionUI(e.target.value);
      });
    }

    if (sampleBtn && pasteArea) {
      sampleBtn.addEventListener('click', () => {
        const isGranit = state.activeUser === 'Granit';
        const sample = isGranit
          ? `* Weight:  56.0 kg\n* BMI:  24.2 bmi\n* Body fat:  20.0 %\n* Muscle mass:  41.5 kg\n* Bone mass:  2.2 kg\n* BMR:  1,250 kcal\n* Body water:  55.2 %\n* Metabolic Age:  26 years\n* Visceral fat:  3.0\n* Muscle quality:  72 mq\n* Body type:  5`
          : `* Weight:  70.5 kg\n* BMI:  23.3 bmi\n* Body fat:  15.8 %\n* Muscle mass:  56.45 kg\n* Bone mass:  3 kg\n* BMR:  1,698 kcal\n* Body water:  54.3 %\n* Metabolic Age:  32 years\n* Visceral fat:  6.5\n* Muscle quality:  72 mq\n* Body type:  5`;
        pasteArea.value = sample;
        updateDetectionUI(sample);
      });
    }

    if (parseAndSaveBtn) {
      parseAndSaveBtn.addEventListener('click', () => {
        const raw = pasteArea ? pasteArea.value : '';
        const parsed = parseTanitaText(raw) || this.smartPasteDraft;
        const dateInput = document.getElementById('smart-paste-date');
        const entryDate = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];

        if (!parsed || (parsed.weight === null && parsed.visceralFat === null && parsed.bodyFat === null)) {
          if (alertBox) {
            alertBox.className = 'p-2.5 rounded-xl text-xs font-bold text-center bg-red-500/20 text-red-400 border border-red-500/30';
            alertBox.textContent = 'לא זוהו נתונים בטקסט. אנא הדבק טקסט תקין מ-My Tanita או לחץ "הדבק טקסט לדוגמה".';
            alertBox.classList.remove('hidden');
          }
          return;
        }

        const newEntry = {
          date: entryDate,
          weight: parsed.weight || state.getCurrentProfile().currentWeight || 70,
          bmi: parsed.bmi,
          bodyFat: parsed.bodyFat || 18,
          visceralFat: parsed.visceralFat || 4,
          muscleKg: parsed.muscleKg || 55,
          boneMass: parsed.boneMass || null,
          bmr: parsed.bmr || 1650,
          waterPct: parsed.waterPct || 55,
          metabolicAge: parsed.metabolicAge,
          muscleQuality: parsed.muscleQuality,
          bodyType: parsed.bodyType,
          source: 'smart_paste'
        };

        saveTanitaEntry(state.activeUser, newEntry);
        this.smartPasteDraft = null;

        if (alertBox) {
          alertBox.className = 'p-2.5 rounded-xl text-xs font-bold text-center bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
          alertBox.textContent = 'מדידת טניטה (11 מדדים) פוענחה ונשמרה בהצלחה!';
          alertBox.classList.remove('hidden');
        }

        this.showToast('מדידת טניטה (11 מדדים) נשמרה בהצלחה! ✓');

        setTimeout(() => {
          this.render();
        }, 500);
      });
    }

    const form = document.getElementById('tanita-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const parseSanitizedFloat = (id) => {
          const el = document.getElementById(id);
          if (!el || el.value === '' || el.value === null || el.value === undefined) return null;
          const s = String(el.value).trim().replace(',', '.');
          const n = parseFloat(s);
          return isNaN(n) ? null : n;
        };

        const weightVal = parseSanitizedFloat('tanita-weight') ?? 0;
        const bmiVal = parseSanitizedFloat('tanita-bmi');
        const fatVal = parseSanitizedFloat('tanita-fat') ?? 0;
        const visceralVal = parseSanitizedFloat('tanita-visceral') ?? 1;
        const muscleVal = parseSanitizedFloat('tanita-muscle') ?? 0;
        const boneVal = parseSanitizedFloat('tanita-bone');
        const bmrVal = parseSanitizedFloat('tanita-bmr');
        const waterVal = parseSanitizedFloat('tanita-water');
        const metaAgeVal = parseSanitizedFloat('tanita-metabolic-age');
        const muscleQVal = parseSanitizedFloat('tanita-muscle-quality');
        const bodyTypeVal = parseSanitizedFloat('tanita-body-type');

        const entry = {
          date: document.getElementById('tanita-date').value,
          weight: weightVal,
          bmi: bmiVal,
          bodyFat: fatVal,
          visceralFat: visceralVal,
          muscleKg: muscleVal,
          boneMass: boneVal,
          bmr: bmrVal,
          waterPct: waterVal,
          metabolicAge: metaAgeVal,
          muscleQuality: muscleQVal,
          bodyType: bodyTypeVal,
          source: 'manual'
        };

        saveTanitaEntry(state.activeUser, entry);
        this.showToast('מדידת טניטה ידנית נשמרה בהצלחה! ✓');
        this.render();
      });
    }

    document.querySelectorAll('.delete-tanita-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.currentTarget.getAttribute('data-delete-tanita');
        if (id) {
          deleteTanitaEntry(state.activeUser, id);
          this.showToast('המדידה נמחקה בהצלחה! ✓', 'info');
          this.render();
        }
      });
    });

    const clearAllTanitaBtn = document.getElementById('btn-clear-all-tanita');
    if (clearAllTanitaBtn) {
      clearAllTanitaBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.confirmingClearTanita) {
          this.confirmingClearTanita = true;
          clearAllTanitaBtn.className = 'text-xs text-white border border-red-500 bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer font-black transition-all shadow-md';
          clearAllTanitaBtn.innerHTML = `
            <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i>
            <span>⚠️ לחץ כאן שוב לאישור מחיקת כל הרישומים</span>
          `;
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
          if (this.clearTanitaTimeout) clearTimeout(this.clearTanitaTimeout);
          this.clearTanitaTimeout = setTimeout(() => {
            this.confirmingClearTanita = false;
            this.render();
          }, 4500);
          return;
        }

        // Confirmed second click
        if (this.clearTanitaTimeout) clearTimeout(this.clearTanitaTimeout);
        this.confirmingClearTanita = false;
        clearAllTanitaHistory(state.activeUser);
        this.showToast(`כל רישומי הטניטה של ${state.getCurrentProfile().hebrewName} נמחקו בהצלחה! ✓`, 'info');
        this.render();
      });
    }

    // Bind Accordion persistence for Tanita modules
    this.bindAccordion('tanita-charts-acc', 'tanita_charts');
    this.bindAccordion('tanita-combined-chart-acc', 'tanita_combined_chart');
    this.bindAccordion('tanita-manual-acc', 'tanita_manual');
    this.bindAccordion('tanita-table-acc', 'tanita_table');

    // Tanita Info Modal trigger buttons (?)
    document.querySelectorAll('[data-tanita-info]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const metricKey = e.currentTarget.getAttribute('data-tanita-info');
        if (metricKey) {
          this.openTanitaInfoModal(metricKey);
        }
      });
    });

    // Combined Chart Scale Switcher (original vs normalized)
    document.querySelectorAll('[data-combined-scale]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = e.currentTarget.getAttribute('data-combined-scale');
        if (mode && this.combinedScaleMode !== mode) {
          this.combinedScaleMode = mode;
          this.render();
        }
      });
    });

    // Combined Chart Toggle Individual Metric
    document.querySelectorAll('[data-toggle-combined-metric]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const metricKey = e.currentTarget.getAttribute('data-toggle-combined-metric');
        if (metricKey) {
          if (!this.combinedHiddenMetrics) this.combinedHiddenMetrics = [];
          if (this.combinedHiddenMetrics.includes(metricKey)) {
            this.combinedHiddenMetrics = this.combinedHiddenMetrics.filter(k => k !== metricKey);
          } else {
            this.combinedHiddenMetrics.push(metricKey);
          }
          this.render();
        }
      });
    });

    // Combined Chart Preset Filters
    document.querySelectorAll('[data-combined-preset]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const preset = e.currentTarget.getAttribute('data-combined-preset');
        if (preset === 'fat_loss') {
          const active = ['weight', 'bodyFat', 'visceralFat', 'bmi'];
          this.combinedHiddenMetrics = TANITA_METRIC_CONFIGS.map(m => m.key).filter(k => !active.includes(k));
          this.render();
        } else if (preset === 'muscle_quality') {
          const active = ['weight', 'muscleKg', 'muscleQuality', 'boneMass'];
          this.combinedHiddenMetrics = TANITA_METRIC_CONFIGS.map(m => m.key).filter(k => !active.includes(k));
          this.render();
        }
      });
    });

    // Combined Chart Quick Actions
    document.querySelectorAll('[data-combined-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = e.currentTarget.getAttribute('data-combined-action');
        if (action === 'select_all') {
          this.combinedHiddenMetrics = [];
          this.render();
        } else if (action === 'clear_all') {
          this.combinedHiddenMetrics = TANITA_METRIC_CONFIGS.map(m => m.key);
          this.render();
        }
      });
    });

    // Timeframe Filter Buttons (7 ימים, 30 ימים, 90 ימים, הכל)
    document.querySelectorAll('.timeframe-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tf = e.currentTarget.getAttribute('data-tanita-timeframe');
        if (tf) {
          this.chartTimeframe = tf;
          this.render();
        }
      });
    });

    // View Mode Toggle (all_11 vs both vs single)
    document.querySelectorAll('.chart-view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const vm = e.currentTarget.getAttribute('data-tanita-view');
        if (vm) {
          this.chartViewMode = vm;
          this.render();
        }
      });
    });

    // Single Metric Pill Selection in focused mode
    document.querySelectorAll('[data-select-single-metric]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const metricKey = e.currentTarget.getAttribute('data-select-single-metric');
        if (metricKey) {
          this.selectedSingleMetric = metricKey;
          this.render();
        }
      });
    });
  }

  // --- CHART.JS RENDERING ENGINE ---
  renderProgressCharts() {
    if (typeof Chart === 'undefined') return;

    const user = state.activeUser;
    let history = [...getTanitaHistory(user)].reverse();
    const profile = state.getCurrentProfile();

    // Filter history based on selected timeframe
    if (this.chartTimeframe && this.chartTimeframe !== 'all' && history.length > 0) {
      const days = parseInt(this.chartTimeframe, 10);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      const filtered = history.filter(h => h.date >= cutoffStr);
      history = filtered.length > 0 ? filtered : history.slice(-days);
    }

    if (this.charts) {
      Object.values(this.charts).forEach(c => {
        try {
          if (c && typeof c.destroy === 'function') c.destroy();
        } catch (e) {}
      });
    }
    this.charts = {};

    const isLight = isThemeLight(state.theme);
    let textColor = '#f8fafc';
    let subTextColor = '#94a3b8';
    let gridColor = 'rgba(51, 65, 85, 0.3)';

    if (isLight) {
      if (state.theme === 'emerald') {
        textColor = '#064e3b';
        subTextColor = '#047857';
        gridColor = 'rgba(167, 243, 208, 0.6)';
      } else if (state.theme === 'midnight') {
        textColor = '#0c4a6e';
        subTextColor = '#0369a1';
        gridColor = 'rgba(186, 230, 253, 0.6)';
      } else if (state.theme === 'cream') {
        textColor = '#78350f';
        subTextColor = '#92400e';
        gridColor = 'rgba(231, 222, 209, 0.7)';
      } else {
        textColor = '#0f172a';
        subTextColor = '#334155';
        gridColor = 'rgba(203, 213, 225, 0.65)';
      }
    }

    const labels = history.map(h => {
      const parts = h.date.split('-');
      return `${parts[2]}/${parts[1]}`;
    });

    // 1. VIEW MODE: ALL 11 METRICS SEPARATE CHARTS
    if (this.chartViewMode === 'all_11') {
      TANITA_METRIC_CONFIGS.forEach(m => {
        const ctx = document.getElementById(`canvas-metric-${m.key}`);
        if (!ctx || history.length === 0) return;

        const data = history.map(h => {
          const v = h[m.key];
          return (v !== undefined && v !== null && !isNaN(v)) ? Number(v) : null;
        });

        this.charts[m.key] = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: `${m.name} (${m.unit})`,
                data,
                borderColor: m.color,
                backgroundColor: m.color + '22',
                borderWidth: 2.5,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: m.color,
                pointBorderColor: isLight ? '#ffffff' : '#020617',
                pointBorderWidth: 1.5,
                pointRadius: history.length > 20 ? 2 : 4,
                pointHoverRadius: 6
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: 'index',
              intersect: false
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => `${m.name}: ${ctx.raw} ${m.unit}`
                }
              }
            },
            scales: {
              x: {
                grid: { color: gridColor },
                ticks: { color: subTextColor, font: { size: 9 }, maxRotation: 45 }
              },
              y: {
                grid: { color: gridColor },
                ticks: { color: subTextColor, font: { size: 9 } }
              }
            }
          }
        });
      });
    }

    // 2. VIEW MODE: SINGLE FOCUSED METRIC CHART
    if (this.chartViewMode === 'single') {
      const activeKey = this.selectedSingleMetric || 'weight';
      const m = TANITA_METRIC_CONFIGS.find(cfg => cfg.key === activeKey) || TANITA_METRIC_CONFIGS[0];
      const ctxSingle = document.getElementById('canvas-single-metric');

      if (ctxSingle && history.length > 0) {
        const data = history.map(h => {
          const v = h[m.key];
          return (v !== undefined && v !== null && !isNaN(v)) ? Number(v) : null;
        });

        const validVals = data.filter(v => v !== null);
        const avg = validVals.length ? Number((validVals.reduce((a, b) => a + b, 0) / validVals.length).toFixed(1)) : null;

        const datasets = [
          {
            label: `${m.name} (${m.unit})`,
            data,
            borderColor: m.color,
            backgroundColor: m.color + '25',
            borderWidth: 3,
            fill: true,
            tension: 0.3,
            pointBackgroundColor: m.color,
            pointBorderColor: isLight ? '#ffffff' : '#020617',
            pointBorderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7
          }
        ];

        if (avg !== null) {
          datasets.push({
            label: `ממוצע: ${avg} ${m.unit}`,
            data: history.map(() => avg),
            borderColor: isLight ? '#64748b' : '#94a3b8',
            borderWidth: 1.5,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0
          });
        }

        this.charts.single = new Chart(ctxSingle, {
          type: 'line',
          data: {
            labels,
            datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: 'index',
              intersect: false
            },
            plugins: {
              legend: {
                labels: { color: textColor, font: { size: 11, weight: 'bold' } }
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => `${ctx.dataset.label}: ${ctx.raw} ${m.unit}`
                }
              }
            },
            scales: {
              x: {
                grid: { color: gridColor },
                ticks: { color: subTextColor, font: { size: 10 } }
              },
              y: {
                grid: { color: gridColor },
                ticks: { color: subTextColor, font: { size: 10 } },
                title: { display: true, text: `${m.name} (${m.unit})`, color: m.color, font: { size: 11, weight: 'bold' } }
              }
            }
          }
        });
      }
    }

    // 3. VIEW MODE: DUAL-AXIS FLAGSHIP CHARTS (Weight & Muscle + Visceral & Body Fat %)
    if (this.chartViewMode === 'both') {
      const ctxWeight = document.getElementById('canvas-weight-muscle');
      if (ctxWeight && history.length > 0) {
        const weights = history.map(h => h.weight);
        const muscles = history.map(h => h.muscleKg || null);

        this.charts.weight = new Chart(ctxWeight, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'משקל (ק"ג)',
                data: weights,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                borderWidth: 3,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#10b981',
                pointRadius: 5,
                yAxisID: 'yWeight'
              },
              {
                label: 'מסת שריר (ק"ג)',
                data: muscles,
                borderColor: '#3b82f6',
                backgroundColor: 'transparent',
                borderWidth: 2.5,
                borderDash: [5, 5],
                fill: false,
                tension: 0.3,
                pointBackgroundColor: '#3b82f6',
                pointRadius: 4,
                yAxisID: 'yMuscle'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: 'index',
              intersect: false
            },
            plugins: {
              legend: {
                labels: { color: textColor, font: { size: 11 } }
              }
            },
            scales: {
              x: {
                grid: { color: gridColor },
                ticks: { color: subTextColor, font: { size: 10 } }
              },
              yWeight: {
                type: 'linear',
                position: 'left',
                grid: { color: gridColor },
                ticks: { color: '#10b981', font: { size: 10 } },
                title: { display: true, text: 'משקל (ק"ג)', color: '#10b981', font: { size: 10, weight: 'bold' } }
              },
              yMuscle: {
                type: 'linear',
                position: 'right',
                grid: { drawOnChartArea: false },
                ticks: { color: '#3b82f6', font: { size: 10 } },
                title: { display: true, text: 'שריר (ק"ג)', color: '#3b82f6', font: { size: 10, weight: 'bold' } }
              }
            }
          }
        });
      }

      const ctxVisceral = document.getElementById('canvas-visceral-fat');
      if (ctxVisceral && history.length > 0) {
        const visceralData = history.map(h => h.visceralFat);
        const targetLine = history.map(() => profile.targetVisceralFat);
        const bodyFatData = history.map(h => h.bodyFat || null);

        this.charts.visceral = new Chart(ctxVisceral, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'שומן ויסצראלי נמדד',
                data: visceralData,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.18)',
                borderWidth: 3,
                fill: true,
                tension: 0.25,
                pointBackgroundColor: '#f59e0b',
                pointRadius: 5,
                yAxisID: 'yVisceral'
              },
              {
                label: `יעד רצוי (≤${profile.targetVisceralFat})`,
                data: targetLine,
                borderColor: '#10b981',
                borderWidth: 2,
                borderDash: [6, 6],
                fill: false,
                pointRadius: 0,
                yAxisID: 'yVisceral'
              },
              {
                label: 'אחוז שומן (%)',
                data: bodyFatData,
                borderColor: '#ec4899',
                backgroundColor: 'transparent',
                borderWidth: 2.5,
                borderDash: [3, 3],
                fill: false,
                tension: 0.25,
                pointBackgroundColor: '#ec4899',
                pointRadius: 4,
                yAxisID: 'yFatPct'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: 'index',
              intersect: false
            },
            plugins: {
              legend: {
                labels: { color: textColor, font: { size: 11 } }
              }
            },
            scales: {
              x: {
                grid: { color: gridColor },
                ticks: { color: subTextColor, font: { size: 10 } }
              },
              yVisceral: {
                type: 'linear',
                position: 'left',
                min: 1,
                suggestedMax: 10,
                grid: { color: gridColor },
                ticks: { color: '#f59e0b', font: { size: 10 } },
                title: { display: true, text: 'שומן ויסצראלי', color: '#f59e0b', font: { size: 10, weight: 'bold' } }
              },
              yFatPct: {
                type: 'linear',
                position: 'right',
                grid: { drawOnChartArea: false },
                ticks: { color: '#ec4899', font: { size: 10 } },
                title: { display: true, text: 'אחוז שומן (%)', color: '#ec4899', font: { size: 10, weight: 'bold' } }
              }
            }
          }
        });
      }
    }

    // 4. DAILY MACRO & CALORIE COMPLIANCE (Past 7 Days - Always rendered)
    const ctxMacro = document.getElementById('canvas-macro-compliance');
    if (ctxMacro) {
      const dates = [];
      const calData = [];
      const proteinData = [];
      const today = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dStr = d.toISOString().split('T')[0];
        dates.push(`${d.getDate()}/${d.getMonth() + 1}`);
        const dayMeals = getMealsForDate(user, dStr);
        const dayMacro = calculateDailyMacros(dayMeals);
        calData.push(dayMacro.kcal);
        proteinData.push(dayMacro.protein);
      }

      this.charts.macro = new Chart(ctxMacro, {
        type: 'bar',
        data: {
          labels: dates,
          datasets: [
            {
              label: `קלוריות (יעד: ${profile.targetKcal})`,
              data: calData,
              backgroundColor: 'rgba(16, 185, 129, 0.78)',
              borderColor: '#10b981',
              borderWidth: 1,
              yAxisID: 'y'
            },
            {
              label: `חלבון גרם (יעד: ${profile.targetProtein}g)`,
              data: proteinData,
              backgroundColor: 'rgba(6, 182, 212, 0.78)',
              borderColor: '#06b6d4',
              borderWidth: 1,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: textColor, font: { size: 11 } }
            }
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: { color: subTextColor, font: { size: 10 } }
            },
            y: {
              type: 'linear',
              position: 'left',
              grid: { color: gridColor },
              ticks: { color: '#10b981', font: { size: 10 } },
              title: { display: true, text: 'קלוריות', color: '#10b981', font: { size: 10 } }
            },
            y1: {
              type: 'linear',
              position: 'right',
              grid: { drawOnChartArea: false },
              ticks: { color: '#06b6d4', font: { size: 10 } },
              title: { display: true, text: 'חלבון (גרם)', color: '#06b6d4', font: { size: 10 } }
            }
          }
        }
      });
    }

    // 5. COMBINED MULTI-METRIC CHART (All 11 Metrics on Single Canvas)
    const ctxCombined = document.getElementById('canvas-combined-metrics');
    if (ctxCombined && history.length > 0) {
      const isNormalized = this.combinedScaleMode === 'normalized';
      const hidden = this.combinedHiddenMetrics || [];
      const isBmrActive = !hidden.includes('bmr');

      const datasets = [];
      TANITA_METRIC_CONFIGS.forEach(m => {
        if (hidden.includes(m.key)) return;

        let baseline = null;
        const data = history.map(h => {
          const v = h[m.key];
          if (v === undefined || v === null || isNaN(v)) return null;
          const num = Number(v);
          if (!isNormalized) {
            return num;
          }
          if (baseline === null) baseline = num;
          if (baseline === 0) return 0;
          return Number((((num - baseline) / baseline) * 100).toFixed(1));
        });

        datasets.push({
          label: isNormalized ? `${m.shortName} (% שינוי)` : `${m.name} (${m.unit})`,
          data,
          borderColor: m.color,
          backgroundColor: m.color + '18',
          borderWidth: 2.2,
          fill: false,
          tension: 0.25,
          pointBackgroundColor: m.color,
          pointBorderColor: isLight ? '#ffffff' : '#020617',
          pointBorderWidth: 1.5,
          pointRadius: history.length > 20 ? 2.5 : 4,
          pointHoverRadius: 6,
          yAxisID: isNormalized ? 'yPct' : (m.key === 'bmr' ? 'yBmr' : 'yGeneral')
        });
      });

      const scales = {
        x: {
          grid: { color: gridColor },
          ticks: { color: subTextColor, font: { size: 10 }, maxRotation: 45 }
        }
      };

      if (isNormalized) {
        scales.yPct = {
          type: 'linear',
          position: 'left',
          grid: { color: gridColor },
          ticks: {
            color: subTextColor,
            font: { size: 10 },
            callback: (v) => `${v > 0 ? '+' : ''}${v}%`
          },
          title: {
            display: true,
            text: 'אחוז שינוי מצטבר מהמדידה הראשונה (%)',
            color: subTextColor,
            font: { size: 11, weight: 'bold' }
          }
        };
      } else {
        scales.yGeneral = {
          type: 'linear',
          position: 'left',
          grid: { color: gridColor },
          ticks: { color: subTextColor, font: { size: 10 } },
          title: {
            display: true,
            text: 'ערך נמדד (משקל / הרכב גוף)',
            color: subTextColor,
            font: { size: 10, weight: 'bold' }
          }
        };

        if (isBmrActive) {
          scales.yBmr = {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#06b6d4', font: { size: 10 } },
            title: {
              display: true,
              text: 'BMR (kcal)',
              color: '#06b6d4',
              font: { size: 10, weight: 'bold' }
            }
          };
        }
      }

      this.charts.combined = new Chart(ctxCombined, {
        type: 'line',
        data: {
          labels,
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: textColor,
                font: { size: 11 },
                boxWidth: 12,
                usePointStyle: true
              }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const ds = datasets[ctx.datasetIndex];
                  const val = ctx.raw;
                  if (val === null || val === undefined) return '';
                  return `${ds.label}: ${val > 0 && isNormalized ? '+' : ''}${val}${isNormalized ? '%' : ''}`;
                }
              }
            }
          },
          scales
        }
      });
    }
  }

  // --- COACH VIEW ---
  getCoachHTML() {
    const profile = state.getCurrentProfile();
    return `
      <div class="space-y-6">
        <div class="dashboard-card bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold">
              <i data-lucide="bot" class="w-5 h-5"></i>
            </div>
            <div>
              <h2 class="text-xl font-extrabold text-slate-100">מאמן התזונה האישי (Gemini AI)</h2>
              <p class="text-xs text-slate-400">ניתוח מקצועי המבוסס על צריכת המאקרו היומית ומדדי הטניטה שלך.</p>
            </div>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            המאמן מנתח באופן מדויק את היעד של ${profile.hebrewName} (${profile.focus}) עם יעד קלוריות מחושב אוטומטית של ${profile.targetKcal} kcal וחלבון ${profile.targetProtein}g, ומספק משוב ממוקד לשריפת שומן ויסצראלי ושמירה על מסת שריר.
          </p>
          <div class="mt-4 flex justify-end">
            <button id="ask-coach-btn" class="btn-primary text-xs flex items-center gap-2">
              <i data-lucide="sparkles" class="w-4 h-4"></i>
              בקש ניתוח ומשוב מהמאמן
            </button>
          </div>
        </div>

        <div id="coach-response-card" class="dashboard-card hidden space-y-3">
          <h3 class="text-sm font-bold text-emerald-400 flex items-center gap-2">
            <i data-lucide="check-circle-2" class="w-4 h-4"></i>
            חוות דעת המאמן:
          </h3>
          <div id="coach-response-text" class="text-sm text-slate-200 leading-relaxed bg-slate-950/70 p-4 rounded-xl border border-slate-800 whitespace-pre-line"></div>
        </div>

        <!-- Scroll Clearance Spacer -->
        <div class="h-20 sm:h-24 w-full shrink-0"></div>
      </div>
    `;
  }

  bindCoachEvents() {
    const btn = document.getElementById('ask-coach-btn');
    const responseCard = document.getElementById('coach-response-card');
    const responseText = document.getElementById('coach-response-text');

    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> מעבד נתונים ומנתח...`;
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          window.lucide.createIcons();
        }
        responseCard.classList.remove('hidden');
        responseText.innerHTML = `
          <div class="flex items-center gap-2 text-slate-400 py-1">
            <i data-lucide="loader-2" class="w-4 h-4 animate-spin text-emerald-400"></i>
            <span>המאמן מנתח את נתוני המאקרו, האימון והטניטה שלך...</span>
          </div>
        `;
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          window.lucide.createIcons();
        }

        try {
          const feedback = await fetchAiCoachingFeedback();
          responseText.innerHTML = `
            <div class="space-y-2 leading-relaxed text-sm">
              <p class="whitespace-pre-line">${feedback}</p>
            </div>
          `;
        } catch (err) {
          responseText.innerHTML = `
            <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-1.5">
              <div class="font-bold flex items-center gap-1.5 text-amber-300">
                <i data-lucide="alert-circle" class="w-4 h-4"></i>
                <span>עומס זמני בשירות ה-AI</span>
              </div>
              <p>השרת חווה עומס זמני רגעי. לחץ על הכפתור מטה לניסיון חוזר מיידי.</p>
              <button id="coach-retry-btn" type="button" class="mt-2 px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-100 font-bold cursor-pointer inline-flex items-center gap-1">
                <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> נסה שוב כעת
              </button>
            </div>
          `;
          const retryBtn = document.getElementById('coach-retry-btn');
          if (retryBtn) {
            retryBtn.onclick = () => btn.click();
          }
        } finally {
          btn.disabled = false;
          btn.innerHTML = `<i data-lucide="sparkles" class="w-4 h-4"></i> בקש ניתוח ומשוב מהמאמן`;
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
        }
      });
    }
  }

  // --- SETTINGS VIEW (AUTO-MACRO ENGINE POWERED) ---
  getSettingsHTML() {
    const profile = state.getCurrentProfile();
    const isArik = state.activeUser === 'Arik';

    return `
      <div class="space-y-6">
        <!-- Header Banner -->
        <div class="dashboard-card bg-gradient-to-br from-slate-900/90 to-slate-800/80 border-slate-700/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${isArik ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'}">
                פרופיל: ${profile.hebrewName}
              </span>
              <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                מנוע מאקרו אוטומטי פעיל
              </span>
            </div>
            <h2 class="text-xl font-extrabold text-slate-100">הגדרות פרופיל ומשקל יעד</h2>
            <p class="text-xs text-slate-400">
              הגדר רק את משקל היעד שלך — יעדי הקלוריות, החלבון, הפחמימות והשומן מחושבים אוטומטית לפי מדידת ה-BMR של טניטה.
            </p>
          </div>
          ${state.canSwitchProfiles() ? `
            <div class="flex flex-wrap bg-slate-950/80 p-1 rounded-xl border border-slate-800 self-stretch sm:self-auto justify-center gap-1">
              ${state.getAllUserProfiles().map(u => {
                const isActive = state.activeUser === u.name;
                const isArikUser = u.name === 'Arik';
                const isGranitUser = u.name === 'Granit';
                const activeColor = isArikUser 
                  ? 'bg-emerald-500 text-slate-950 font-extrabold shadow-sm' 
                  : isGranitUser
                    ? 'bg-cyan-500 text-slate-950 font-extrabold shadow-sm'
                    : 'bg-amber-500 text-slate-950 font-extrabold shadow-sm';
                return `
                  <button
                    type="button"
                    data-switch-profile="${u.name}"
                    class="px-3.5 py-2 rounded-lg text-xs font-bold transition-all min-h-[44px] flex items-center justify-center cursor-pointer ${
                      isActive ? activeColor : 'text-slate-400 hover:text-slate-200'
                    }"
                  >
                    ${u.hebrewName || u.name}
                  </button>
                `;
              }).join('')}
            </div>
          ` : `
            <div class="flex items-center gap-2 bg-slate-950/80 px-3.5 py-2 rounded-xl border border-emerald-500/30 text-emerald-300 text-xs font-bold">
              <i data-lucide="lock" class="w-4 h-4 text-emerald-400"></i>
              <span>פרופיל נעול למשתמש זה</span>
            </div>
          `}
        </div>

        <!-- 1. 👥 User Profiles & Creation Management Card (הקמת וניהול משתמשים) -->
        <div class="dashboard-card space-y-5 border-cyan-500/40 bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 shadow-xl">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-800">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center font-bold shrink-0">
                <i data-lucide="users" class="w-5 h-5"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-base font-bold text-slate-100">הקמת וניהול משתמשי המערכת</h3>
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">פרופילים פעילים</span>
                </div>
                <p class="text-xs text-slate-400">נהל את משתמשי המערכת, הקם משתמשים חדשים עם יעדים אישיים וחשבון Gmail מקושר</p>
              </div>
            </div>
          </div>

          <!-- Existing Users Grid -->
          <div class="space-y-2">
            <div class="text-xs font-bold text-slate-300 flex items-center justify-between">
              <span>משתמשים מוגדרים במערכת:</span>
              <span class="text-[10px] text-slate-400">${state.getAllUserProfiles().length} פרופילים זמינים</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              ${state.getAllUserProfiles().map(u => {
                const isActive = state.activeUser === u.name;
                const isPermanent = u.name === 'Arik' || u.name === 'Granit';
                return `
                  <div class="p-3 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                    isActive 
                      ? 'bg-slate-800/90 border-emerald-500/60 ring-2 ring-emerald-500/20 shadow-md' 
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }">
                    <div>
                      <div class="flex items-center justify-between gap-2 mb-1.5">
                        <div class="flex items-center gap-2">
                          <div class="w-8 h-8 rounded-lg ${isActive ? 'bg-emerald-500 text-slate-950 font-black' : 'bg-slate-800 text-slate-200 font-bold'} flex items-center justify-center text-xs">
                            ${u.hebrewName ? u.hebrewName.slice(0, 2) : u.name.slice(0, 2)}
                          </div>
                          <div>
                            <div class="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                              <span>${u.hebrewName || u.name}</span>
                              <span class="text-[10px] font-mono text-slate-400">(${u.name})</span>
                            </div>
                            <div class="text-[10px] text-slate-400">
                              ${u.gender === 'female' ? 'אישה' : 'גבר'} • גובה ${u.height || 170} ס"מ
                            </div>
                          </div>
                        </div>
                        ${isActive ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">פעיל כעת</span>' : ''}
                      </div>

                      <div class="mt-2 text-[10px] text-cyan-300 font-mono dir-ltr text-right px-2 py-1 rounded bg-slate-900/90 border border-slate-800/80 flex items-center justify-between">
                        <span class="text-slate-400 font-sans">Gmail:</span>
                        <span class="truncate ml-1">${u.email ? u.email : '<span class="text-slate-500 italic font-sans">ללא חשבון מקושר</span>'}</span>
                      </div>

                      <div class="grid grid-cols-2 gap-1.5 mt-2 py-2 px-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 text-[11px]">
                        <div>
                          <span class="text-slate-400 block text-[10px]">משקל יעד:</span>
                          <strong class="text-emerald-400 font-mono font-bold">${u.targetWeight} ק"ג</strong>
                        </div>
                        <div>
                          <span class="text-slate-400 block text-[10px]">יעד קלוריות:</span>
                          <strong class="text-amber-400 font-mono font-bold">${u.targetKcal} kcal</strong>
                        </div>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 pt-1 border-t border-slate-800/60">
                      ${state.canSwitchProfiles() ? `
                        ${!isActive ? `
                          <button
                            type="button"
                            data-switch-profile="${u.name}"
                            class="btn-secondary text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1.5 cursor-pointer hover:border-emerald-500/50 hover:text-emerald-300 font-bold"
                          >
                            <i data-lucide="user-check" class="w-3.5 h-3.5"></i>
                            <span>בחר משתמש</span>
                          </button>
                        ` : `
                          <div class="text-xs text-emerald-400 font-bold flex-1 text-center py-1.5">
                            ✓ משתמש נוכחי
                          </div>
                        `}
                        ${(!isPermanent && state.canManageUsers()) ? `
                          <button
                            type="button"
                            data-delete-user="${u.name}"
                            class="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg border border-transparent hover:border-red-500/20 cursor-pointer transition-colors"
                            title="מחק משתמש זה"
                          >
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                          </button>
                        ` : ''}
                      ` : `
                        <div class="text-xs ${isActive ? 'text-emerald-400 font-bold' : 'text-slate-500'} flex-1 text-center py-1.5 flex items-center justify-center gap-1">
                          ${isActive ? '<i data-lucide="lock" class="w-3.5 h-3.5 text-emerald-400"></i><span>הפרופיל שלך (נעול)</span>' : '<span class="text-slate-600">אין גישה לפרופיל זה</span>'}
                        </div>
                      `}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Create User Form (Only for Super Admin) -->
          ${state.canManageUsers() ? `
            <div class="pt-4 border-t border-slate-800/80">
              <div class="flex items-center gap-2 mb-3">
                <i data-lucide="user-plus" class="w-4 h-4 text-cyan-400"></i>
                <h4 class="text-sm font-bold text-slate-100">הקמת משתמש חדש במערכת</h4>
              </div>
              
              <form id="create-user-form" class="space-y-3 p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-300 mb-1">
                      מזהה ייחודי באנגלית <span class="text-cyan-400 font-mono">(לדוגמה: David, Maya)</span>
                    </label>
                    <input
                      type="text"
                      id="new-user-name"
                      placeholder="User ID (English)"
                      required
                      pattern="[A-Za-z0-9_-]+"
                      class="input-field text-xs text-slate-100 w-full dir-ltr text-right"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-300 mb-1">
                      שם מלא לתצוגה בעברית <span class="text-slate-400">(לדוגמה: דוד, מיה)</span>
                    </label>
                    <input
                      type="text"
                      id="new-user-hebrew-name"
                      placeholder="שם בעברית"
                      required
                      class="input-field text-xs text-slate-100 w-full"
                    />
                  </div>
                </div>

                <div>
                  <label for="new-user-email" class="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                    <span class="flex items-center gap-1.5">
                      <i data-lucide="mail" class="w-3.5 h-3.5 text-cyan-400"></i>
                      <span>כתובת Gmail מקושרת (להתחברות באמצעות Google)</span>
                    </span>
                    <span class="text-cyan-400 font-mono text-[10px]">(Google Sign-In)</span>
                  </label>
                  <input
                    type="email"
                    id="new-user-email"
                    placeholder="user@gmail.com"
                    class="input-field text-xs text-slate-100 w-full dir-ltr text-right font-mono"
                  />
                  <p class="text-[11px] text-slate-400 mt-1">משתמש זה יוכל להתחבר ישירות באמצעות ה-Gmail שלו ויהיה מקושר רק לפרופיל זה.</p>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-300 mb-1">מגדר</label>
                    <select id="new-user-gender" class="input-field text-xs text-slate-100 w-full">
                      <option value="male">זכר</option>
                      <option value="female">נקבה</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-300 mb-1">גובה (ס"מ)</label>
                    <input
                      type="number"
                      id="new-user-height"
                      value="172"
                      min="100"
                      max="230"
                      required
                      class="input-field text-xs text-slate-100 w-full"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-300 mb-1">משקל התחלתי (ק"ג)</label>
                    <input
                      type="number"
                      step="0.1"
                      id="new-user-start-weight"
                      value="75"
                      min="35"
                      max="250"
                      required
                      class="input-field text-xs text-slate-100 w-full"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-300 mb-1">משקל יעד (ק"ג)</label>
                    <input
                      type="number"
                      step="0.1"
                      id="new-user-target-weight"
                      value="68"
                      min="35"
                      max="250"
                      required
                      class="input-field text-xs text-slate-100 w-full"
                    />
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-semibold text-slate-300 mb-1">
                    מטרת פוקוס / תיאור יעד
                  </label>
                  <input
                    type="text"
                    id="new-user-focus"
                    placeholder="לדוגמה: ירידה במשקל, חיטוב והפחתת שומן בטני"
                    class="input-field text-xs text-slate-100 w-full"
                  />
                </div>

                <div class="pt-2 flex justify-end">
                  <button
                    type="submit"
                    id="create-user-btn"
                    class="btn-primary text-xs font-bold py-2.5 px-5 flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
                  >
                    <i data-lucide="plus-circle" class="w-4 h-4"></i>
                    <span>הקם ושמור משתמש חדש</span>
                  </button>
                </div>
              </form>
            </div>
          ` : `
            <div class="pt-3 border-t border-slate-800/80">
              <div class="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-400 flex items-center gap-2">
                <i data-lucide="lock" class="w-4 h-4 text-slate-500 shrink-0"></i>
                <span>הקמת משתמשים חדשים וניהול פרופילים מוגבלים לחשבון מנהל המערכת (Super Admin).</span>
              </div>
            </div>
          `}
        </div>

        <!-- 2. Auto-Macro Engine Card -->
        <div class="dashboard-card bg-slate-950/70 border-emerald-500/30 space-y-3">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-800">
            <div class="flex items-center gap-2">
              <i data-lucide="sparkles" class="w-4 h-4 text-amber-400"></i>
              <h3 class="text-sm font-extrabold text-slate-100">מנוע מאקרו אוטומטי (Auto-Macro Engine)</h3>
            </div>
            <div class="text-[11px] text-slate-400">
              תחזוקה TDEE: <strong class="text-slate-200">${profile.maintenanceTdee || 2228} kcal</strong> | BMR: <strong class="text-cyan-400">${profile.measuredBmr || (isArik ? 1650 : 1250)} kcal</strong>
            </div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div class="bg-slate-900/90 p-3 rounded-xl border border-slate-800 text-center">
              <div class="text-[11px] text-slate-400">יעד קלוריות יומי</div>
              <div id="inline-auto-kcal" class="text-xl font-black text-emerald-400">${profile.targetKcal} kcal</div>
              <div id="inline-auto-deficit" class="text-[10px] text-slate-500 mt-0.5">גירעון: -${profile.deficitKcal || 678} kcal</div>
            </div>
            <div class="bg-slate-900/90 p-3 rounded-xl border border-slate-800 text-center">
              <div class="text-[11px] text-slate-400">יעד חלבון יומי</div>
              <div id="inline-auto-protein" class="text-xl font-black text-blue-400">${profile.targetProtein}g</div>
              <div class="text-[10px] text-slate-500 mt-0.5">~1.8g לק"ג משקל יעד</div>
            </div>
            <div class="bg-slate-900/90 p-3 rounded-xl border border-slate-800 text-center">
              <div class="text-[11px] text-slate-400">יעד פחמימות יומי</div>
              <div id="inline-auto-carbs" class="text-xl font-black text-amber-400">${profile.targetCarbs}g</div>
              <div class="text-[10px] text-slate-500 mt-0.5">איזון אנרגטי וגליקוגן</div>
            </div>
            <div class="bg-slate-900/90 p-3 rounded-xl border border-slate-800 text-center">
              <div class="text-[11px] text-slate-400">יעד שומן יומי</div>
              <div id="inline-auto-fat" class="text-xl font-black text-purple-400">${profile.targetFat}g</div>
              <div class="text-[10px] text-slate-500 mt-0.5">תמיכה הורמונלית</div>
            </div>
          </div>
        </div>

        <!-- Inline Direct Edit Form (Manual macros removed) -->
        <form id="inline-profile-form" class="space-y-6">
          <!-- Account & Gmail Link Section -->
          <div class="dashboard-card space-y-3">
            <div class="flex items-center gap-2 text-sm font-bold text-slate-200 pb-2 border-b border-slate-800">
              <i data-lucide="mail" class="w-4 h-4 text-cyan-400"></i>
              <span>חשבון Gmail מקושר (Google Sign-In)</span>
            </div>
            <div>
              <label for="inline-email" class="block text-xs font-medium text-slate-400 mb-1.5 flex items-center justify-between">
                <span>כתובת Gmail להתחברות לפרופיל זה</span>
                <span class="text-[10px] text-cyan-400 font-mono">${profile.email || 'לא הוגדר'}</span>
              </label>
              <input
                type="email"
                id="inline-email"
                value="${profile.email || ''}"
                placeholder="user@gmail.com"
                class="input-field text-xs text-cyan-300 font-mono dir-ltr text-right"
              />
              <p class="text-[11px] text-slate-400 mt-1">משתמש זה יוכל להתחבר ישירות עם חשבון Google ויהיה מקושר רק לפרופיל זה.</p>
            </div>
          </div>

          <!-- Physical & Weight Section -->
          <div class="dashboard-card space-y-3">
            <div class="flex items-center gap-2 text-sm font-bold text-slate-200 pb-2 border-b border-slate-800">
              <i data-lucide="ruler" class="w-4 h-4 text-cyan-400"></i>
              <span>נתונים פיזיים ומשקלים</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label for="inline-height" class="block text-xs font-medium text-slate-400 mb-1.5">גובה (ס"מ)</label>
                <input type="number" id="inline-height" min="100" max="230" step="any" required value="${profile.height}" class="input-field text-sm font-bold text-slate-100" />
              </div>
              <div>
                <label for="inline-start-weight" class="block text-xs font-medium text-slate-400 mb-1.5">משקל התחלתי (ק"ג)</label>
                <input type="number" id="inline-start-weight" min="30" max="250" step="any" required value="${profile.startWeight || profile.currentWeight || 70}" class="input-field text-sm font-bold text-amber-300" />
              </div>
              <div>
                <label for="inline-target-weight" class="block text-xs font-medium text-slate-400 mb-1.5">
                  משקל יעד (ק"ג) <span class="text-emerald-400 font-bold">*קובע מאקרו</span>
                </label>
                <input type="number" id="inline-target-weight" min="30" max="250" step="any" required value="${profile.targetWeight || (isArik ? 67 : 50)}" class="input-field text-sm font-bold text-emerald-400 border-emerald-500/50" />
              </div>
            </div>
          </div>

          <!-- Body Composition & Focus Section -->
          <div class="dashboard-card space-y-3">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-800">
              <div class="flex items-center gap-2 text-sm font-bold text-slate-200">
                <i data-lucide="scale" class="w-4 h-4 text-emerald-400"></i>
                <span>יעדי הרכב גוף (טניטה) ומטרת אימון</span>
              </div>
              <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300 flex items-center gap-1">
                <span>🔒</span>
                <span>יעדים רפואיים נעולים</span>
              </span>
            </div>
            <p class="text-xs text-slate-400">
              משקל טניטה מודד את המצב הקיים בכל שקילה. שדות אלו הם היעד הרפואי הבריא אליו שואפים בגרף המגמה (נקבעו ונעלו אוטומטית לפי תקן רפואי).
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="inline-target-visceral" class="block text-xs font-medium text-slate-400 mb-1.5 flex items-center justify-between">
                  <span>שומן ויסצראלי יעד (1-12)</span>
                  <span class="text-[10px] text-amber-400 font-bold">🔒 נעול (${isArik ? 'מומלץ לגבר: 4' : 'מומלץ לאישה: 3'})</span>
                </label>
                <input type="number" id="inline-target-visceral" min="1" max="15" step="any" readonly value="${profile.targetVisceralFat}" class="input-field text-sm font-bold text-amber-400 bg-slate-950/60 cursor-not-allowed" />
              </div>
              <div>
                <label for="inline-target-body-fat" class="block text-xs font-medium text-slate-400 mb-1.5 flex items-center justify-between">
                  <span>אחוז שומן יעד (%)</span>
                  <span class="text-[10px] text-emerald-400 font-bold">🔒 נעול (${isArik ? 'חיטוב גבר: 15%' : 'חיטוב אישה: 20%'})</span>
                </label>
                <input type="number" id="inline-target-body-fat" min="3" max="50" step="any" readonly value="${profile.targetBodyFat}" class="input-field text-sm font-bold text-emerald-400 bg-slate-950/60 cursor-not-allowed" />
              </div>
            </div>
            <div>
              <label for="inline-focus" class="block text-xs font-medium text-slate-400 mb-1.5">מטרת פוקוס אישית</label>
              <input type="text" id="inline-focus" required value="${profile.focus || ''}" class="input-field text-xs text-slate-100" />
            </div>
          </div>

          <div id="inline-settings-alert" class="hidden p-3 rounded-xl text-xs font-bold text-center transition-all"></div>

          <!-- Form Submit Actions -->
          <div class="dashboard-card flex flex-col sm:flex-row items-center justify-between gap-3">
            <button type="button" id="inline-reset-btn" class="text-xs text-slate-400 hover:text-red-400 transition-colors py-2 px-3 rounded-lg hover:bg-slate-800/60 cursor-pointer min-h-[44px] flex items-center justify-center">
              שחזר ברירות מחדל מקוריות
            </button>
            <button type="submit" class="btn-primary text-sm font-bold py-3 px-6 w-full sm:w-auto flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer min-h-[44px]">
              <i data-lucide="check" class="w-4 h-4"></i>
              שמור שינויים עבור ${profile.hebrewName}
            </button>
          </div>
        </form>

        <!-- Theme Selection Card -->
        <div class="dashboard-card space-y-4">
          <div class="flex items-center gap-2 pb-2 border-b border-slate-800">
            <i data-lucide="palette" class="w-5 h-5 text-emerald-400"></i>
            <div>
              <h3 class="text-base font-bold text-slate-100">ערכת נושא לעיצוב האפליקציה</h3>
              <p class="text-xs text-slate-400">בחר את המראה והגוון המועדף עליך (נשמר באופן קבוע במכשיר)</p>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${AVAILABLE_THEMES.map(theme => {
              const isActive = (state.theme || 'slate') === theme.id;
              return `
                <button
                  type="button"
                  data-select-theme="${theme.id}"
                  class="p-3.5 rounded-xl border text-right transition-all cursor-pointer flex items-center justify-between ${
                    isActive
                      ? 'bg-emerald-500/15 border-emerald-500 text-slate-100 ring-2 ring-emerald-500/30'
                      : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 text-slate-300'
                  }"
                >
                  <div class="flex items-center gap-3">
                    <div
                      class="w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm shrink-0"
                      style="background: ${theme.id === 'oled' ? '#000000' : theme.id === 'midnight' ? '#070d1e' : theme.id === 'emerald' ? '#04140b' : theme.id === 'light' ? '#ffffff' : theme.id === 'cream' ? '#faf7f2' : '#0a0f1d'}; border-color: ${theme.id === 'light' || theme.id === 'cream' ? '#cbd5e1' : '#334155'}; color: ${theme.accentColor};"
                    >
                      <i data-lucide="${theme.icon}" class="w-5 h-5"></i>
                    </div>
                    <div>
                      <div class="text-xs font-bold flex items-center gap-1.5">
                        <span>${theme.name}</span>
                        ${theme.badge ? `<span class="text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-emerald-500/25 text-emerald-300 font-extrabold' : 'bg-slate-800 text-slate-400'}">${theme.badge}</span>` : ''}
                      </div>
                      <div class="text-[11px] text-slate-400 mt-0.5">${theme.desc}</div>
                    </div>
                  </div>
                  <div class="shrink-0 mr-2">
                    ${isActive ? '<span class="text-emerald-400 text-sm font-bold flex items-center gap-1"><i data-lucide="check" class="w-4 h-4"></i> פעיל</span>' : '<span class="w-4 h-4 rounded-full border border-slate-700 inline-block"></span>'}
                  </div>
                </button>
              `;
            }).join('')}
          </div>
        </div>



        <!-- Admin Whitelist Management Card (Super Admin Arik: arik.pic@gmail.com) -->
        <div class="dashboard-card space-y-4 border-emerald-500/40 bg-gradient-to-br from-emerald-950/25 via-slate-900 to-slate-950 shadow-xl shadow-emerald-950/20">
          <div class="flex items-center justify-between pb-3 border-b border-slate-800">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold">
                <i data-lucide="shield-check" class="w-5 h-5"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-sm sm:text-base font-bold text-slate-100">ניהול משתמשים מורשים (Super Admin)</h3>
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">Admin Whitelist</span>
                </div>
                <p class="text-xs text-slate-400">הוסף או הסר חשבונות Gmail המורשים לגשת לאפליקציה ולסנכרן נתונים בענן</p>
              </div>
            </div>
          </div>

          <!-- Add Email Form -->
          <form id="admin-whitelist-form" class="flex flex-col sm:flex-row gap-2 pt-1">
            <input
              type="email"
              id="admin-new-email-input"
              placeholder="כתובת Gmail להרשאה (לדוגמה: user@gmail.com)"
              required
              class="input-field text-xs text-slate-100 flex-1"
            />
            <button
              type="submit"
              id="admin-add-email-btn"
              class="btn-primary text-xs font-bold py-2.5 px-4 flex items-center justify-center gap-2 cursor-pointer shrink-0 min-h-[42px]"
            >
              <i data-lucide="user-plus" class="w-4 h-4"></i>
              <span>הוסף משתמש מורשה</span>
            </button>
          </form>

          <!-- Whitelist List -->
          <div class="space-y-2 pt-1">
            <div class="text-xs font-bold text-slate-300 flex items-center justify-between">
              <span>משתמשים בעלי הרשאת גישה פעילה:</span>
              <span class="text-[10px] text-slate-400 font-normal">סנכרון ענן בזמן אמת</span>
            </div>
            <div class="space-y-1.5" id="admin-whitelist-container">
              ${[
                'arik.pic@gmail.com',
                ...(state.whitelist || []).filter(e => e.toLowerCase() !== 'arik.pic@gmail.com')
              ].map(email => {
                const isSuper = email.toLowerCase() === 'arik.pic@gmail.com';
                return `
                  <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs hover:border-slate-700 transition-colors">
                    <div class="flex items-center gap-2">
                      <i data-lucide="${isSuper ? 'crown' : 'user-check'}" class="w-4 h-4 ${isSuper ? 'text-amber-400' : 'text-emerald-400'}"></i>
                      <span class="font-mono text-slate-200 dir-ltr text-right">${email}</span>
                      ${isSuper ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">Super Admin</span>' : '<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">מורשה</span>'}
                    </div>
                    ${!isSuper ? `
                      <button
                        type="button"
                        data-remove-email="${email}"
                        class="text-red-400 hover:text-red-300 p-1.5 rounded-lg hover:bg-red-500/10 cursor-pointer transition-colors"
                        title="הסר הרשאה"
                      >
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                      </button>
                    ` : '<span class="text-[10px] text-slate-500 italic">קבוע</span>'}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <!-- Data Backup & Restore -->
        <div class="dashboard-card space-y-4">
          <h3 class="text-sm font-bold text-slate-200">גיבוי ושחזור נתונים (JSON)</h3>
          <p class="text-xs text-slate-400 leading-relaxed">
            ניתן לייצא את כל נתוני המעקב, יעדי הפרופיל וההיסטוריה לקובץ JSON או לשחזר נתונים מקובץ גיבוי קודם.
          </p>
          <div class="flex flex-wrap gap-3">
            <button id="export-btn" class="btn-secondary text-xs flex items-center gap-2 cursor-pointer">
              <i data-lucide="download" class="w-4 h-4"></i>
              ייצא נתונים (JSON)
            </button>
            <label class="btn-secondary text-xs flex items-center gap-2 cursor-pointer">
              <i data-lucide="upload" class="w-4 h-4"></i>
              שחזר נתונים
              <input type="file" id="import-file" accept=".json" class="hidden" />
            </label>
            <button id="settings-clear-tanita-btn" class="text-xs text-red-400 hover:text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 px-3 py-2 rounded-xl flex items-center gap-2 cursor-pointer transition-all">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
              <span>מחק היסטוריית טניטה (${profile.hebrewName})</span>
            </button>
          </div>
        </div>

        <!-- Scroll Clearance Spacer -->
        <div class="h-20 sm:h-24 w-full shrink-0"></div>
      </div>
    `;
  }

  bindSettingsEvents() {
    // Dynamic profile switch buttons
    document.querySelectorAll('[data-switch-profile]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const userKey = e.currentTarget.getAttribute('data-switch-profile');
        if (userKey) {
          state.setActiveUser(userKey);
          const p = state.getCurrentProfile();
          this.showToast(`עברת לפרופיל ${p.hebrewName || userKey} ✓`, 'info');
          this.render();
        }
      });
    });

    // Create User Form
    const createUserForm = document.getElementById('create-user-form');
    if (createUserForm) {
      createUserForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('new-user-name');
        const hebrewNameInput = document.getElementById('new-user-hebrew-name');
        const emailInput = document.getElementById('new-user-email');
        const genderSelect = document.getElementById('new-user-gender');
        const heightInput = document.getElementById('new-user-height');
        const startWeightInput = document.getElementById('new-user-start-weight');
        const targetWeightInput = document.getElementById('new-user-target-weight');
        const focusInput = document.getElementById('new-user-focus');

        const rawName = nameInput ? nameInput.value.trim() : '';
        const hebrewName = hebrewNameInput ? hebrewNameInput.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const gender = genderSelect ? genderSelect.value : 'male';
        const height = Number(heightInput?.value) || 170;
        const startWeight = Number(startWeightInput?.value) || 70;
        const targetWeight = Number(targetWeightInput?.value) || 65;
        const focus = focusInput ? focusInput.value.trim() : '';

        if (!rawName || !hebrewName) {
          this.showToast('נא למלא מזהה באנגלית ושם בעברית', 'error');
          return;
        }

        const newProfile = state.createUser({
          name: rawName,
          hebrewName,
          email,
          gender,
          height,
          startWeight,
          targetWeight,
          focus
        });

        this.showToast(`המשתמש ${newProfile.hebrewName} הוקם בהצלחה! הפרופיל נבחר כעת ✓`, 'success');
        this.render();
      });
    }

    // Delete User with Double Confirmation Modal
    document.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const userToDelete = e.currentTarget.getAttribute('data-delete-user');
        if (!userToDelete) return;
        this.openDeleteUserDoubleConfirmModal(userToDelete);
      });
    });

    const arikSwitch = document.getElementById('inline-switch-arik');
    const granitSwitch = document.getElementById('inline-switch-granit');

    if (arikSwitch) {
      arikSwitch.addEventListener('click', () => {
        state.setActiveUser('Arik');
        this.showToast('עברת לפרופיל אריק ✓', 'info');
      });
    }
    if (granitSwitch) {
      granitSwitch.addEventListener('click', () => {
        state.setActiveUser('Granit');
        this.showToast('עברת לפרופיל גרניט ✓', 'info');
      });
    }

    const inlineTargetWeight = document.getElementById('inline-target-weight');
    if (inlineTargetWeight) {
      inlineTargetWeight.addEventListener('input', (e) => {
        const targetW = Number(e.target.value) || (state.activeUser === 'Arik' ? 67 : 50);
        const auto = calculateAutoMacros(state.activeUser, targetW, state.getCurrentProfile().measuredBmr);

        const setText = (id, txt) => {
          const el = document.getElementById(id);
          if (el) el.textContent = txt;
        };

        setText('inline-auto-kcal', `${auto.targetKcal} kcal`);
        setText('inline-auto-deficit', `גירעון: -${auto.deficitKcal} kcal`);
        setText('inline-auto-protein', `${auto.targetProtein}g`);
        setText('inline-auto-carbs', `${auto.targetCarbs}g`);
        setText('inline-auto-fat', `${auto.targetFat}g`);
      });
    }

    const form = document.getElementById('inline-profile-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const isGranit = state.activeUser === 'Granit';
        const currentProfile = state.getCurrentProfile();

        const parseSanitizedFloat = (id, fallback) => {
          const el = document.getElementById(id);
          if (!el || el.value === '' || el.value === null || el.value === undefined) return fallback;
          const s = String(el.value).trim().replace(',', '.');
          const n = parseFloat(s);
          return isNaN(n) ? fallback : n;
        };

        const emailVal = document.getElementById('inline-email')?.value?.trim();
        const updatedData = {
          email: emailVal !== undefined ? emailVal.toLowerCase() : (currentProfile.email || ''),
          height: parseSanitizedFloat('inline-height', isGranit ? 152 : 174),
          startWeight: parseSanitizedFloat('inline-start-weight', isGranit ? 56 : 70),
          currentWeight: currentProfile.currentWeight || parseSanitizedFloat('inline-start-weight', isGranit ? 56 : 70),
          targetWeight: parseSanitizedFloat('inline-target-weight', isGranit ? 50 : 67),
          targetVisceralFat: parseSanitizedFloat('inline-target-visceral', isGranit ? 3 : 4),
          targetBodyFat: parseSanitizedFloat('inline-target-body-fat', isGranit ? 20.0 : 15.0),
          focus: document.getElementById('inline-focus')?.value?.trim() || (isGranit ? 'חיטוב ואיזון הרכב גוף' : 'הפחתת שומן בטני (ויסצראלי) תוך שמירה על מסת שריר'),
        };

        state.updateCurrentProfile(updatedData);

        this.showToast(`נתוני ${state.getCurrentProfile().hebrewName} נשמרו בהצלחה! משקל יעד: ${updatedData.targetWeight} ק"ג, גובה: ${updatedData.height} ס"מ`);

        const alertBox = document.getElementById('inline-settings-alert');
        if (alertBox) {
          alertBox.className = 'p-3 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-center block';
          alertBox.textContent = `נתוני הפרופיל ומשקל היעד של ${state.getCurrentProfile().hebrewName} נשמרו בהצלחה! יעדי המאקרו עודכנו אוטומטית.`;
          alertBox.classList.remove('hidden');
          setTimeout(() => {
            alertBox.classList.add('hidden');
          }, 3500);
        }
      });
    }

    const resetBtn = document.getElementById('inline-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!this.confirmingInlineProfileReset) {
          this.confirmingInlineProfileReset = true;
          const originalText = resetBtn.textContent;
          resetBtn.textContent = 'לחץ שוב לאישור איפוס';
          setTimeout(() => {
            this.confirmingInlineProfileReset = false;
            if (resetBtn) resetBtn.textContent = originalText;
          }, 4000);
          return;
        }
        this.confirmingInlineProfileReset = false;
        state.resetCurrentProfile();
        this.showToast('נתוני הפרופיל אופסו לברירת מחדל בהצלחה! ✓', 'info');
        this.render();
      });
    }

    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const jsonStr = exportAllData();
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fitness_tracker_backup_${state.activeUser}_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('קובץ גיבוי יוצא בהצלחה! ✓');
      });
    }

    const importInput = document.getElementById('import-file');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          const success = importAllData(event.target.result);
          if (success) {
            this.showToast('כל הנתונים שוחזרו בהצלחה! ✓');
            this.render();
          } else {
            this.showToast('שגיאה בשחזור הנתונים. קובץ JSON לא תקין.', 'error');
          }
        };
        reader.readAsText(file);
      });
    }

    const settingsClearTanita = document.getElementById('settings-clear-tanita-btn');
    if (settingsClearTanita) {
      settingsClearTanita.addEventListener('click', (e) => {
        e.preventDefault();
        if (!this.confirmingSettingsClearTanita) {
          this.confirmingSettingsClearTanita = true;
          const originalHTML = settingsClearTanita.innerHTML;
          settingsClearTanita.className = 'text-xs text-white border border-red-500 bg-red-600 hover:bg-red-700 px-3 py-2 rounded-xl flex items-center gap-2 cursor-pointer font-black shadow-md';
          settingsClearTanita.innerHTML = '<i data-lucide="alert-triangle" class="w-4 h-4"></i><span>לחץ שוב למחיקת כל נתוני הטניטה</span>';
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
          setTimeout(() => {
            this.confirmingSettingsClearTanita = false;
            if (settingsClearTanita) {
              settingsClearTanita.className = 'text-xs text-red-400 hover:text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 px-3 py-2 rounded-xl flex items-center gap-2 cursor-pointer transition-all';
              settingsClearTanita.innerHTML = originalHTML;
              if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
              }
            }
          }, 4500);
          return;
        }

        this.confirmingSettingsClearTanita = false;
        clearAllTanitaHistory(state.activeUser);
        this.showToast(`כל נתוני הטניטה של ${state.getCurrentProfile().hebrewName} נמחקו בהצלחה! ✓`, 'info');
        this.render();
      });
    }

    document.querySelectorAll('[data-select-theme]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const themeId = e.currentTarget.getAttribute('data-select-theme');
        state.setTheme(themeId);
        const selected = AVAILABLE_THEMES.find(t => t.id === themeId);
        this.showToast(`ערכת נושא עודכנה ל-${selected?.name || themeId} ✓`);
        this.render();
      });
    });

    // Admin Whitelist Form & Removal
    const adminWhitelistForm = document.getElementById('admin-whitelist-form');
    if (adminWhitelistForm) {
      adminWhitelistForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('admin-new-email-input');
        const email = input ? input.value.trim().toLowerCase() : '';
        if (!email || !email.includes('@')) {
          this.showToast('נא להזין כתובת דוא"ל חוקית', 'error');
          return;
        }
        const btn = document.getElementById('admin-add-email-btn');
        if (btn) btn.disabled = true;

        try {
          await addEmailToWhitelist(email);
          const updatedList = await fetchWhitelist();
          state.setWhitelist(updatedList);
          this.showToast(`המשתמש ${email} נוסף בהצלחה לרשימת הגישה! ✓`, 'success');
          this.render();
        } catch (err) {
          console.error('Failed to add email to whitelist:', err);
          this.showToast('שגיאה בהוספת משתמש לרשימה', 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    document.querySelectorAll('[data-remove-email]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const emailToRemove = e.currentTarget.getAttribute('data-remove-email');
        if (!emailToRemove) return;
        if (confirm(`האם להסיר את הרשאת הגישה עבור ${emailToRemove}?`)) {
          try {
            await removeEmailFromWhitelist(emailToRemove);
            const updatedList = await fetchWhitelist();
            state.setWhitelist(updatedList);
            this.showToast(`המשתמש ${emailToRemove} הוסר מרשימת הגישה ✓`, 'info');
            this.render();
          } catch (err) {
            console.error('Failed to remove email:', err);
            this.showToast(err.message || 'שגיאה בהסרת משתמש', 'error');
          }
        }
      });
    });
  }
}

function initApp() {
  try {
    if (!window.appInstance || !(window.app instanceof App)) {
      window.appInstance = new App();
      window.app = window.appInstance;
    }
  } catch (err) {
    console.error('Fatal initialization error in new App():', err);
    const container = document.getElementById('view-dashboard');
    if (container) {
      container.innerHTML = `
        <div class="p-6 bg-red-950/80 border border-red-500 rounded-2xl text-center space-y-3 m-4">
          <div class="text-2xl">⚠️</div>
          <h3 class="text-base font-bold text-red-200">אירעה שגיאה באיתחול האפליקציה</h3>
          <p class="text-xs text-red-300 font-mono text-left dir-ltr p-3 bg-slate-950 rounded-lg overflow-x-auto">${err.stack || err.message || err}</p>
          <button onclick="localStorage.clear(); location.reload();" class="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-bold rounded-xl cursor-pointer">
            אפס נתונים וטען מחדש
          </button>
        </div>
      `;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
