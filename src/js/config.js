export const DEFAULT_PROFILES = {
  Arik: {
    name: 'Arik',
    hebrewName: 'אריק',
    gender: 'male',
    email: 'arik.pic@gmail.com',
    height: 174,
    currentWeight: 70,
    startWeight: 70,
    targetWeight: 67,
    focus: 'הפחתת שומן בטני (ויסצראלי) תוך שמירה על מסת שריר',
    targetKcal: 1550,
    targetProtein: 120,
    targetCarbs: 110,
    targetFat: 50,
    targetVisceralFat: 4,
    targetBodyFat: 15.0,
    measuredBmr: 1650,
    maintenanceTdee: 2228,
    deficitKcal: 678,
  },
  Granit: {
    name: 'Granit',
    hebrewName: 'גרניט',
    gender: 'female',
    email: 'granit@gmail.com',
    height: 152,
    currentWeight: 56,
    startWeight: 56,
    targetWeight: 50,
    focus: 'חיטוב ואיזון הרכב גוף',
    targetKcal: 1250,
    targetProtein: 90,
    targetCarbs: 105,
    targetFat: 45,
    targetVisceralFat: 3,
    targetBodyFat: 20.0,
    measuredBmr: 1250,
    maintenanceTdee: 1688,
    deficitKcal: 438,
  },
  Maor: {
    name: 'Maor',
    hebrewName: 'מאור',
    gender: 'male',
    email: 'maor@gmail.com',
    height: 175,
    currentWeight: 72,
    startWeight: 72,
    targetWeight: 68,
    focus: 'בניית שריר וחיטוב (AGM Fit)',
    targetKcal: 1650,
    targetProtein: 130,
    targetCarbs: 130,
    targetFat: 50,
    targetVisceralFat: 4,
    targetBodyFat: 15.0,
    measuredBmr: 1680,
    maintenanceTdee: 2268,
    deficitKcal: 618,
  }
};

export const STORAGE_KEYS = {
  USER_LIST: 'ag_user_list',
  ACTIVE_USER: 'ag_active_user',
  SELECTED_DATE: 'ag_selected_date',
  MEALS_PREFIX: 'ag_meals_',
  TANITA_PREFIX: 'ag_tanita_',
  PROFILE_PREFIX: 'ag_profile_',
  WORKOUT_PREFIX: 'ag_workout_',
};

export function getAllUserKeys() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.USER_LIST);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const unique = Array.from(new Set(['Arik', 'Granit', 'Maor', ...parsed]));
        return unique;
      }
    }
  } catch (e) {
    console.warn('Error reading user list:', e);
  }
  return ['Arik', 'Granit', 'Maor'];
}

export function saveUserKeys(userList) {
  try {
    const cleanList = Array.from(new Set(['Arik', 'Granit', 'Maor', ...(userList || [])]));
    localStorage.setItem(STORAGE_KEYS.USER_LIST, JSON.stringify(cleanList));
  } catch (e) {
    console.warn('Error saving user list:', e);
  }
}

/**
 * Intelligent Auto-Macro Generator
 * Maintenance TDEE = measured BMR * 1.35
 * Deficit and macros derived directly from Target Weight and measured Tanita BMR.
 * - Arik target 67kg: ~1550 kcal, 120g protein, 110g carbs, 50g fat
 * - Granit target 50kg: ~1250 kcal, 90g protein, 105g carbs, 45g fat
 * - Custom users: calculated based on target weight, gender, and BMR
 */
export function calculateAutoMacros(userName, targetWeight, measuredBmr = 0) {
  let isFemale = userName === 'Granit';
  try {
    const raw = localStorage.getItem(`${STORAGE_KEYS.PROFILE_PREFIX}${userName}`);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.gender === 'female') isFemale = true;
    }
  } catch (e) {}

  const isArik = userName === 'Arik';
  const targetW = Number(targetWeight) || (isArik ? 67 : isFemale ? 50 : 70);

  const baseBmr = measuredBmr && Number(measuredBmr) > 800 ? Number(measuredBmr) : (isArik ? 1650 : isFemale ? 1250 : 1600);
  const maintenanceTdee = Math.round(baseBmr * 1.35);

  if (isArik) {
    // Target 67kg -> 120g protein, 50g fat, 110g carbs, 1550 kcal
    const protein = Math.round(targetW * (120 / 67));
    const fat = Math.round(targetW * (50 / 67));
    const bmrOffset = (baseBmr - 1650) * 0.7;
    const targetKcal = Math.round(Math.max(1300, 1550 + bmrOffset + (targetW - 67) * 15));
    const remainingKcal = Math.max(0, targetKcal - (protein * 4 + fat * 9));
    const carbs = Math.round(remainingKcal / 4);

    return {
      maintenanceTdee,
      deficitKcal: Math.max(0, maintenanceTdee - targetKcal),
      targetKcal,
      targetProtein: protein,
      targetCarbs: carbs,
      targetFat: fat,
      measuredBmr: baseBmr,
    };
  } else if (isFemale) {
    // Female macro target: ~1.8g/kg protein, 0.9g/kg fat
    const protein = Math.round(targetW * (90 / 50));
    const fat = Math.round(targetW * (45 / 50));
    const bmrOffset = (baseBmr - 1250) * 0.6;
    const targetKcal = Math.round(Math.max(1100, 1250 + bmrOffset + (targetW - 50) * 12));
    const remainingKcal = Math.max(0, targetKcal - (protein * 4 + fat * 9));
    const carbs = Math.round(remainingKcal / 4);

    return {
      maintenanceTdee,
      deficitKcal: Math.max(0, maintenanceTdee - targetKcal),
      targetKcal,
      targetProtein: protein,
      targetCarbs: carbs,
      targetFat: fat,
      measuredBmr: baseBmr,
    };
  } else {
    // Custom male user: 1.8g/kg protein, 0.75g/kg fat
    const protein = Math.round(targetW * 1.8);
    const fat = Math.round(targetW * 0.75);
    const bmrOffset = (baseBmr - 1600) * 0.65;
    const targetKcal = Math.round(Math.max(1300, maintenanceTdee - 500 + bmrOffset));
    const remainingKcal = Math.max(0, targetKcal - (protein * 4 + fat * 9));
    const carbs = Math.round(remainingKcal / 4);

    return {
      maintenanceTdee,
      deficitKcal: Math.max(0, maintenanceTdee - targetKcal),
      targetKcal,
      targetProtein: protein,
      targetCarbs: carbs,
      targetFat: fat,
      measuredBmr: baseBmr,
    };
  }
}

export function getUserProfile(userName) {
  const defaultProfile = DEFAULT_PROFILES[userName] || DEFAULT_PROFILES.Arik;
  try {
    const stored = localStorage.getItem(`${STORAGE_KEYS.PROFILE_PREFIX}${userName}`);
    let profile = { ...defaultProfile };
    if (stored) {
      profile = { ...profile, ...JSON.parse(stored) };
      // Migrate old defaults for Granit to requested 152cm and 56kg
      if (userName === 'Granit' && (profile.height === 165 || profile.currentWeight === 63 || profile.startWeight === 63)) {
        if (profile.height === 165) profile.height = 152;
        if (profile.currentWeight === 63) profile.currentWeight = 56;
        if (profile.startWeight === 63) profile.startWeight = 56;
        localStorage.setItem(`${STORAGE_KEYS.PROFILE_PREFIX}Granit`, JSON.stringify(profile));
      }
    }

    // Always ensure auto-calculated macros match targetWeight and latest BMR
    const auto = calculateAutoMacros(userName, profile.targetWeight, profile.measuredBmr);
    return {
      ...profile,
      targetKcal: auto.targetKcal,
      targetProtein: auto.targetProtein,
      targetCarbs: auto.targetCarbs,
      targetFat: auto.targetFat,
      maintenanceTdee: auto.maintenanceTdee,
      deficitKcal: auto.deficitKcal,
      measuredBmr: auto.measuredBmr,
    };
  } catch (err) {
    console.error(`Error loading profile for ${userName}:`, err);
    return { ...defaultProfile };
  }
}

export function saveUserProfile(userName, profileData) {
  try {
    const current = getUserProfile(userName);
    const targetWeight = Number(profileData.targetWeight) || current.targetWeight;
    const measuredBmr = profileData.measuredBmr !== undefined ? Number(profileData.measuredBmr) : (current.measuredBmr || (userName === 'Arik' ? 1650 : 1250));

    // Derive daily macros automatically from target weight and BMR
    const auto = calculateAutoMacros(userName, targetWeight, measuredBmr);

    const updated = {
      ...current,
      email: profileData.email !== undefined ? (profileData.email ? profileData.email.trim().toLowerCase() : '') : (current.email || ''),
      height: Number(profileData.height) || current.height,
      startWeight: Number(profileData.startWeight) || current.startWeight || current.currentWeight,
      currentWeight: Number(profileData.currentWeight) || current.currentWeight,
      targetWeight: targetWeight,
      targetVisceralFat: Number(profileData.targetVisceralFat) || current.targetVisceralFat,
      targetBodyFat: Number(profileData.targetBodyFat) || current.targetBodyFat,
      focus: profileData.focus !== undefined ? profileData.focus : current.focus,
      targetKcal: auto.targetKcal,
      targetProtein: auto.targetProtein,
      targetCarbs: auto.targetCarbs,
      targetFat: auto.targetFat,
      maintenanceTdee: auto.maintenanceTdee,
      deficitKcal: auto.deficitKcal,
      measuredBmr: auto.measuredBmr,
    };

    localStorage.setItem(`${STORAGE_KEYS.PROFILE_PREFIX}${userName}`, JSON.stringify(updated));

    // Sync Targets to Firestore in background
    try {
      import('./firebase.js').then(({ syncTargetsToCloud }) => {
        import('./state.js').then(({ state }) => {
          const userEmail = state.getUserEmailKey();
          if (userEmail) {
            syncTargetsToCloud(userEmail, {
              targetWeight: updated.targetWeight,
              targetKcal: updated.targetKcal,
              targetProtein: updated.targetProtein,
              targetCarbs: updated.targetCarbs,
              targetFat: updated.targetFat,
              targetVisceralFat: updated.targetVisceralFat,
              targetBodyFat: updated.targetBodyFat,
              focus: updated.focus
            }).catch(e => console.warn('Targets cloud sync warning:', e));
          }
        });
      }).catch(err => console.warn('Targets dynamic import warning:', err));
    } catch (e) {
      console.warn('Targets sync error:', e);
    }

    return updated;
  } catch (err) {
    console.error(`Error saving profile for ${userName}:`, err);
    return null;
  }
}

export function recalculateProfileFromTanita(userName, tanitaEntry) {
  if (!tanitaEntry) return;
  const current = getUserProfile(userName);
  const updates = {};
  if (tanitaEntry.weight) {
    updates.currentWeight = Number(tanitaEntry.weight);
  }
  if (tanitaEntry.bmr && Number(tanitaEntry.bmr) > 800) {
    updates.measuredBmr = Number(tanitaEntry.bmr);
  }
  if (tanitaEntry.visceralFat) {
    updates.lastVisceralFat = Number(tanitaEntry.visceralFat);
  }
  if (tanitaEntry.bodyFat) {
    updates.lastBodyFat = Number(tanitaEntry.bodyFat);
  }
  saveUserProfile(userName, updates);
}

export function resetUserProfile(userName) {
  try {
    localStorage.removeItem(`${STORAGE_KEYS.PROFILE_PREFIX}${userName}`);
    return getUserProfile(userName);
  } catch (err) {
    console.error(`Error resetting profile for ${userName}:`, err);
    return DEFAULT_PROFILES[userName];
  }
}

export function createUserProfile({ name, hebrewName, gender = 'male', height = 170, startWeight = 70, targetWeight = 65, focus = '', email = '' }) {
  const cleanKey = name.trim().replace(/[^a-zA-Z0-9_-]/g, '') || `User_${Date.now()}`;
  const hName = hebrewName?.trim() || cleanKey;
  const isFemale = gender === 'female';
  const targetW = Number(targetWeight) || (isFemale ? 55 : 68);
  const startW = Number(startWeight) || targetW;
  const bmr = isFemale ? Math.round(1200 + (startW - 50) * 10) : Math.round(1550 + (startW - 70) * 12);
  const auto = calculateAutoMacros(cleanKey, targetW, bmr);
  const cleanEmail = email ? email.trim().toLowerCase() : '';

  const newProfile = {
    name: cleanKey,
    hebrewName: hName,
    gender: gender,
    email: cleanEmail,
    height: Number(height) || (isFemale ? 160 : 175),
    currentWeight: startW,
    startWeight: startW,
    targetWeight: targetW,
    focus: focus || (isFemale ? 'חיטוב ואיזון הרכב גוף' : 'הפחתת שומן בטני ושיפור מסת שריר'),
    targetKcal: auto.targetKcal,
    targetProtein: auto.targetProtein,
    targetCarbs: auto.targetCarbs,
    targetFat: auto.targetFat,
    targetVisceralFat: isFemale ? 3 : 4,
    targetBodyFat: isFemale ? 20.0 : 15.0,
    measuredBmr: bmr,
    maintenanceTdee: auto.maintenanceTdee,
    deficitKcal: auto.deficitKcal,
  };

  localStorage.setItem(`${STORAGE_KEYS.PROFILE_PREFIX}${cleanKey}`, JSON.stringify(newProfile));
  const users = getAllUserKeys();
  if (!users.includes(cleanKey)) {
    users.push(cleanKey);
    saveUserKeys(users);
  }
  return newProfile;
}

export function deleteUserProfile(userName) {
  if (userName === 'Arik' || userName === 'Granit') return false;
  const users = getAllUserKeys().filter(u => u !== userName);
  saveUserKeys(users);
  localStorage.removeItem(`${STORAGE_KEYS.PROFILE_PREFIX}${userName}`);
  return true;
}

// Keep PROFILES object dynamic for backward compatibility
export const PROFILES = new Proxy(DEFAULT_PROFILES, {
  get(target, prop) {
    if (typeof prop === 'string') {
      const allKeys = getAllUserKeys();
      if (allKeys.includes(prop) || prop === 'Arik' || prop === 'Granit') {
        return getUserProfile(prop);
      }
    }
    return target[prop];
  }
});

// Safe image URL check preventing 404 network errors on missing local assets
export function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/');
}

export const GRANIT_SHAKE_PRESETS = [
  {
    id: 'granit_morning_latte',
    name: 'משקה בוקר (לאטה + PDM)',
    recipe: '3 scoops Cafe Latte (13g each) + 3 scoops PDM (14g each)',
    shortDesc: '3 כפות לאטה (13 גרם) + 3 כפות PDM (14 גרם)',
    kcal: 303,
    protein: 35.9,
    carbs: 21.0,
    fat: 6.7,
    icon: '☕',
    image: null,
    badge: 'בוקר',
    theme: 'border-amber-500/50 bg-gradient-to-br from-amber-500/15 via-slate-900 to-slate-950 hover:border-amber-400',
    btnClass: 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20',
    badgeColor: 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
  },
  {
    id: 'granit_evening_choco',
    name: 'משקה ערב (שוקו + PDM)',
    recipe: '3 scoops Chocolate (13g each) + 3 scoops PDM (14g each)',
    shortDesc: '3 כפות שוקולד (13 גרם) + 3 כפות PDM (14 גרם)',
    kcal: 318,
    protein: 35.9,
    carbs: 23.0,
    fat: 7.2,
    icon: '🍫',
    image: null,
    badge: 'ערב',
    theme: 'border-purple-500/50 bg-gradient-to-br from-purple-500/15 via-slate-900 to-slate-950 hover:border-purple-400',
    btnClass: 'bg-purple-500 hover:bg-purple-400 text-white font-black shadow-lg shadow-purple-500/20',
    badgeColor: 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
  },
  {
    id: 'granit_post_workout_promax',
    name: 'משקה אחרי אימון (PRO MAX מועשר)',
    recipe: '4 scoops Pro Max (12.5g each) + 1 scoop Chocolate (13g) + 1 scoop PDM (14g)',
    shortDesc: '4 כפות Pro Max (12.5 גרם) + 1 כף שוקולד (13 גרם) + 1 כף PDM (14 גרם)',
    kcal: 296,
    protein: 37.5,
    carbs: 25.7,
    fat: 3.9,
    icon: '⚡',
    image: null,
    badge: 'אחרי אימון',
    theme: 'border-cyan-500/50 bg-gradient-to-br from-cyan-500/15 via-slate-900 to-slate-950 hover:border-cyan-400',
    btnClass: 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black shadow-lg shadow-cyan-500/20',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
  }
];

export const HERBALIFE_PRODUCTS = [
  {
    id: 'herbalife_protein_chips',
    name: "צ'יפס חלבון Herbalife (שקית 30 גרם)",
    recipe: "שקית חטיף צ'יפס חלבון אפוי Herbalife (30 גרם)",
    servingSize: 'שקית (30 גרם)',
    kcal: 134,
    protein: 11.3,
    carbs: 11.5,
    fat: 4.4,
    icon: '🥔',
    image: null,
    badge: 'שקית 30 גרם',
    theme: 'border-orange-500/50 bg-gradient-to-br from-orange-500/15 via-slate-900 to-slate-950 hover:border-orange-400',
    btnClass: 'bg-orange-500 hover:bg-orange-400 text-slate-950 font-black shadow-lg shadow-orange-500/20',
    badgeColor: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
    toast: "צ'יפס חלבון נוסף בהצלחה! ✓"
  }
];

export const QUICK_PRESETS = [
  {
    id: 'olive_oil_tsp',
    name: 'כפית שמן זית (5 מ״ל)',
    recipe: 'כפית שמן זית כתית מעולה עשיר בשומן חד-בלתי רווי (5 מ״ל)',
    kcal: 41,
    protein: 0.0,
    carbs: 0.0,
    fat: 4.5,
    icon: '🫒',
    image: null,
    badge: '5 מ״ל',
    toast: 'כפית שמן זית נוספה ליומן! ✓'
  },
  {
    id: 'smoked_salmon_100g',
    name: 'פילה סלמון מעושן (100 גרם)',
    recipe: 'מארז 100 גרם פילה סלמון מעושן עשיר באומגה 3',
    kcal: 170,
    protein: 20.9,
    carbs: 0,
    fat: 8.9,
    icon: '🐟',
    image: null,
    badge: '100 גרם',
    toast: 'סלמון מעושן נוסף ליומן! ✓'
  },
  {
    id: 'pita_angel_118g',
    name: 'פיתה שווארמה אנג׳ל (118 גרם)',
    recipe: 'פיתה שווארמה של מאפיית אנג׳ל (118 גרם)',
    kcal: 278,
    protein: 9.2,
    carbs: 55.0,
    fat: 1.7,
    icon: '🫓',
    image: null,
    badge: '118 גרם',
    toast: 'פיתה אנג׳ל נוספה ליומן! ✓'
  },
  {
    id: 'peanuts_30g',
    name: 'בוטנים קלויים (30 גרם)',
    recipe: 'חופן בוטנים קלויים עשיר בשומן בריא וחלבון (30 גרם)',
    kcal: 175,
    protein: 7.7,
    carbs: 4.8,
    fat: 14.8,
    icon: '🥜',
    image: null,
    badge: '30 גרם',
    toast: 'מנת בוטנים נוספה ליומן! ✓'
  },
  {
    id: 'toblerone_white_8g',
    name: 'טובלרון לבן קטן (יחידה 8 גרם)',
    recipe: 'משולש טובלרון שוקולד לבן עדין (8 גרם)',
    kcal: 43,
    protein: 0.5,
    carbs: 5.0,
    fat: 2.3,
    icon: '🍫',
    image: null,
    badge: '8 גרם',
    toast: 'נשנוש טובלרון נוסף ליומן! ✓'
  },
  {
    id: 'toblerone_milk_nuts_8g',
    name: 'טובלרון אגוזים/חלב קטן (יחידה 8 גרם)',
    recipe: 'משולש טובלרון שוקולד חלב דבש ואגוזים (8 גרם)',
    kcal: 43,
    protein: 0.4,
    carbs: 4.8,
    fat: 2.4,
    icon: '🍫',
    image: null,
    badge: '8 גרם',
    toast: 'נשנוש טובלרון נוסף ליומן! ✓'
  },
  {
    id: 'yellow_cheese_sandwich_calibrated',
    name: 'כריך גבינה צהובה (2 פרוסות + 3 כפות גבנ״צ)',
    recipe: '2 פרוסות לחם (80 גרם) + 3 כפות גבינה צהובה מגורדת',
    kcal: 306,
    protein: 15.1,
    carbs: 36.0,
    fat: 10.8,
    icon: '🥪',
    image: null,
    badge: 'כריך מאוזן'
  },
  {
    id: 'egg_sandwich_calibrated',
    name: 'כריך ביצים וסחוג (2 פרוסות + 2 ביצים L)',
    recipe: '2 פרוסות לחם (80 גרם) + 2 ביצים גדולות L + סחוג',
    kcal: 380,
    protein: 21.0,
    carbs: 37.5,
    fat: 13.0,
    icon: '🥪',
    image: null,
    badge: 'כריך מאוזן'
  },
  {
    id: 'eggs_veggies',
    name: '2 ביצים L + 2 ירקות',
    recipe: '2 ביצים גדולות L (150 kcal, 12.6g חלבון) + 2 ירקות טריים (50 kcal, 2g חלבון, 9g פחמימות)',
    kcal: 200,
    protein: 14.6,
    carbs: 9.8,
    fat: 10.0,
    icon: '🍳',
    image: null,
    badge: 'מהיר ומאוזן'
  },
  {
    id: 'chicken_rice',
    name: 'חזה עוף עם אורז וירקות',
    kcal: 450,
    protein: 45,
    carbs: 45,
    fat: 8,
    icon: '🍗',
    image: null,
    badge: 'ארוחת צהריים'
  },
  {
    id: 'tuna_salad',
    name: 'סלט טונה עשיר עם ביצה קשה',
    kcal: 380,
    protein: 35,
    carbs: 10,
    fat: 20,
    icon: '🥗',
    image: null,
    badge: 'עשיר בחלבון'
  },
  {
    id: 'cottage_veggies',
    name: "קוטג' 5% עם ירקות חתוכים",
    kcal: 180,
    protein: 24,
    carbs: 8,
    fat: 5,
    icon: '🧀',
    image: null,
    badge: 'ביניים קל'
  },
  {
    id: 'greek_yogurt_berries',
    name: 'יוגורט יווני 0% עם פירות יער',
    kcal: 190,
    protein: 20,
    carbs: 22,
    fat: 2,
    icon: '🫐',
    image: null,
    badge: 'מרענן'
  },
  {
    id: 'hamburger_bun_88g',
    name: 'לחמניית המבורגר (עם שומשום)',
    recipe: 'לחמניית המבורגר עם שומשום שנשקלה במשקל מדויק (88 גרם)',
    kcal: 260,
    protein: 7.5,
    carbs: 46.0,
    fat: 3.5,
    icon: '🍔',
    image: null,
    badge: '88 גרם',
    toast: 'לחמניית המבורגר (88 גרם) נוספה ליומן! ✓'
  },
  {
    id: 'rice_asado',
    name: 'אורז עם אסאדו',
    recipe: 'אורז עם בשר אסאדו עשיר ומזין',
    kcal: 850,
    protein: 47,
    carbs: 50,
    fat: 50,
    icon: '🥩',
    image: null,
    badge: 'בשרי עשיר',
    toast: 'אורז עם אסאדו (850 קק״ל) נוסף ליומן! ✓'
  },
  {
    id: 'pasta_rosa',
    name: 'פסטה רוזה',
    recipe: 'פסטה ברוטב רוזה עשיר',
    kcal: 620,
    protein: 17,
    carbs: 73,
    fat: 26,
    icon: '🍝',
    image: null,
    badge: 'איטלקי',
    toast: 'פסטה רוזה (620 קק״ל) נוספה ליומן! ✓'
  }
];

// --- APP VERSION & PRODUCTION CLOUD METADATA ---
// Increment this semantic version string on EVERY application change/release
export const APP_VERSION = '2.6.2';
export const APP_HOSTING_URL = 'https://agm-fit.web.app';

