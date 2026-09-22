import { STORAGE_KEYS, QUICK_PRESETS, HERBALIFE_PRODUCTS } from './config.js';
import { getStoredItem, setStoredItem } from './storage.js';
import { state } from './state.js';
import { syncDailyLogToCloud } from './firebase.js';

// Granit's 3 exact recurring daily Herbalife shakes based on official dry powder nutritional labels
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
    badge: 'אחרי אימון',
    theme: 'border-cyan-500/50 bg-gradient-to-br from-cyan-500/15 via-slate-900 to-slate-950 hover:border-cyan-400',
    btnClass: 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black shadow-lg shadow-cyan-500/20',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
  }
];

export const HERBALIFE_INGREDIENTS = [
  {
    id: 'f1',
    name: 'Formula 1 Shake Mix',
    hebrewName: 'פורמולה 1 (F1 Shake Mix)',
    flavor: 'קפה לאטה / שוקולד / וניל',
    servingSize: '2 כפות (26 גרם, 13 גרם לכף)',
    perServing: { kcal: 90, protein: 9, carbs: 11, fat: 1 },
    perScoop: { kcal: 45, protein: 4.5, carbs: 5.5, fat: 0.5 },
    image: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=300&auto=format&fit=crop&q=80',
    iconColor: 'from-amber-400 to-yellow-600',
    badge: 'ארוחה מאוזנת'
  },
  {
    id: 'pdm',
    name: 'Protein Drink Mix (PDM)',
    hebrewName: 'אבקת חלבון PDM (14 גרם לכף)',
    flavor: 'וניל עדין',
    servingSize: '2 כפות (28 גרם, 14 גרם לכף)',
    perServing: { kcal: 108, protein: 15, carbs: 7, fat: 1.5 },
    perScoop: { kcal: 54, protein: 7.5, carbs: 3.5, fat: 0.75 },
    image: 'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f?w=300&auto=format&fit=crop&q=80',
    iconColor: 'from-emerald-400 to-teal-600',
    badge: 'תוספת חלבון מוגברת'
  },
  {
    id: 'rebuild',
    name: 'Herbalife24 Rebuild Strength / Pro Max',
    hebrewName: 'H24 Rebuild / Pro Max',
    flavor: 'שוקולד פרימיום להתאוששות',
    servingSize: '4 כפות (50 גרם, 12.5 גרם לכף)',
    perServing: { kcal: 190, protein: 25, carbs: 18, fat: 1.5 },
    perScoop: { kcal: 47.5, protein: 6.25, carbs: 4.5, fat: 0.38 },
    image: 'https://images.unsplash.com/photo-1594882645126-14020914d58d?w=300&auto=format&fit=crop&q=80',
    iconColor: 'from-cyan-400 to-blue-600',
    badge: 'התאוששות שריר'
  }
];

export const SHAKE_LIQUIDS = [
  { id: 'water', name: 'מים (250 מ"ל)', kcal: 0, protein: 0, carbs: 0, fat: 0 },
  { id: 'almond', name: 'חלב שקדים ללא סוכר (250 מ"ל)', kcal: 35, protein: 1, carbs: 1, fat: 2.5 },
  { id: 'milk1', name: 'חלב 1% דל שומן (250 מ"ל)', kcal: 105, protein: 8.5, carbs: 12, fat: 2.5 }
];

export function calculateShakeNutrition(scoops, liquidId = 'water') {
  let totalKcal = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;

  HERBALIFE_INGREDIENTS.forEach(item => {
    const count = Number(scoops[item.id]) || 0;
    totalKcal += count * item.perScoop.kcal;
    totalProtein += count * item.perScoop.protein;
    totalCarbs += count * item.perScoop.carbs;
    totalFat += count * item.perScoop.fat;
  });

  const liquid = SHAKE_LIQUIDS.find(l => l.id === liquidId) || SHAKE_LIQUIDS[0];
  totalKcal += liquid.kcal;
  totalProtein += liquid.protein;
  totalCarbs += liquid.carbs;
  totalFat += liquid.fat;

  return {
    kcal: Math.round(totalKcal),
    protein: Number(totalProtein.toFixed(1)),
    carbs: Number(totalCarbs.toFixed(1)),
    fat: Number(totalFat.toFixed(1)),
    liquid
  };
}

export function logGranitShakePreset(presetId, userOrDate = 'Arik', dateStr = null) {
  let user = 'Arik';
  let date = null;

  if (userOrDate === 'Arik' || userOrDate === 'Granit') {
    user = userOrDate;
    date = dateStr;
  } else if (typeof userOrDate === 'string' && userOrDate.includes('-')) {
    // If date was passed as second param
    date = userOrDate;
    user = 'Arik';
  }

  if (!date || typeof date !== 'string' || !date.includes('-')) {
    date = new Date().toISOString().split('T')[0];
  }

  const preset = GRANIT_SHAKE_PRESETS.find(p => p.id === presetId);
  if (!preset) return null;
  const shakeMeal = {
    name: preset.name,
    recipe: preset.recipe,
    kcal: preset.kcal,
    protein: preset.protein,
    carbs: preset.carbs,
    fat: preset.fat,
    isHerbalifePreset: true
  };
  return saveMeal(user, date, shakeMeal);
}

export function generateDayEmailReport(user, dateStr, profile, workout = null) {
  const meals = getMealsForDate(user, dateStr);
  const macros = calculateDailyMacros(meals);
  const userName = profile?.hebrewName || (user === 'Granit' ? 'גרניט' : 'אריק');

  let body = `דוח תזונה ומאקרו יומי - ${userName}\n`;
  body += `תאריך: ${dateStr}\n\n`;
  body += `=== תקציב מאקרו וקלוריות ===\n`;
  body += `• קלוריות: ${Math.round(macros.kcal)} / ${profile?.targetKcal || 2000} kcal (נותרו: ${Math.max(0, Math.round((profile?.targetKcal || 2000) - macros.kcal))})\n`;
  body += `• חלבון: ${Math.round(macros.protein)}g / ${profile?.targetProtein || 140}g\n`;
  body += `• פחמימות: ${Math.round(macros.carbs)}g / ${profile?.targetCarbs || 180}g\n`;
  body += `• שומן: ${Math.round(macros.fat)}g / ${profile?.targetFat || 60}g\n\n`;

  body += `=== ארוחות ושייקים שנרשמו (${meals.length}) ===\n`;
  if (meals.length === 0) {
    body += `לא נרשמו ארוחות ליום זה.\n`;
  } else {
    meals.forEach((m, idx) => {
      body += `${idx + 1}. ${m.name}: ${m.kcal} kcal | חלבון: ${m.protein}g | פח': ${m.carbs}g | שומן: ${m.fat}g ${m.recipe ? `(${m.recipe})` : ''} [${m.timestamp || ''}]\n`;
    });
  }

  if (workout && workout.exercised) {
    body += `\n=== אימון ופעילות גופנית ===\n`;
    body += `• בוצע אימון כוח: ${workout.strengthDuration || 0} דקות\n`;
    body += `• צעדים: ${workout.steps || 0}\n`;
    body += `• שריפה (שעון חכם): ${workout.smartwatchKcal || 0} kcal\n`;
  }

  body += `\n---\nנשלח מאפליקציית מעקב כושר ותזונה`;

  const subject = encodeURIComponent(`דוח תזונה ומאקרו - ${userName} (${dateStr})`);
  const mailBody = encodeURIComponent(body);
  return `mailto:arik.pic@gmail.com?subject=${subject}&body=${mailBody}`;
}

export function getMealsForDate(user, dateStr) {
  const key = `${STORAGE_KEYS.MEALS_PREFIX}${user}_${dateStr}`;
  return getStoredItem(key, []);
}

export function setMealsForDate(user, dateStr, meals) {
  const key = `${STORAGE_KEYS.MEALS_PREFIX}${user}_${dateStr}`;
  setStoredItem(key, Array.isArray(meals) ? meals : []);
}

export function saveMeal(user, dateStr, meal) {
  const sanitizeNumber = (val, fallback = 0) => {
    if (val === null || val === undefined || val === '') return fallback;
    if (typeof val === 'number') return isNaN(val) ? fallback : val;
    const s = String(val).trim().replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? fallback : n;
  };

  const key = `${STORAGE_KEYS.MEALS_PREFIX}${user}_${dateStr}`;
  const meals = getMealsForDate(user, dateStr);
  const newMeal = {
    id: 'meal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    name: meal.name || 'ארוחה',
    recipe: meal.recipe || null,
    kcal: Math.round(sanitizeNumber(meal.kcal)),
    protein: Number(sanitizeNumber(meal.protein).toFixed(1)),
    carbs: Number(sanitizeNumber(meal.carbs).toFixed(1)),
    fat: Number(sanitizeNumber(meal.fat).toFixed(1)),
    isHerbalifePreset: Boolean(meal.isHerbalifePreset),
    timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  };
  meals.push(newMeal);
  setStoredItem(key, meals);

  // Background Cloud Sync to Firestore: users/{userEmail}/daily_logs/{dateStr}
  try {
    const userEmail = state.getUserEmailKey();
    if (userEmail) {
      syncDailyLogToCloud(userEmail, dateStr, {
        meals,
        totalMacros: calculateDailyMacros(meals)
      }).catch(err => console.warn('Firestore daily log sync warning:', err));
    }
  } catch (err) {
    console.warn('Daily log sync error:', err);
  }

  return newMeal;
}

export function deleteMeal(user, dateStr, mealId) {
  const key = `${STORAGE_KEYS.MEALS_PREFIX}${user}_${dateStr}`;
  let meals = getMealsForDate(user, dateStr);
  meals = meals.filter(m => m.id !== mealId);
  setStoredItem(key, meals);

  // Background Cloud Sync to Firestore: users/{userEmail}/daily_logs/{dateStr}
  try {
    const userEmail = state.getUserEmailKey();
    if (userEmail) {
      syncDailyLogToCloud(userEmail, dateStr, {
        meals,
        totalMacros: calculateDailyMacros(meals)
      }).catch(err => console.warn('Firestore daily log sync warning:', err));
    }
  } catch (err) {
    console.warn('Daily log sync error:', err);
  }

  return meals;
}

export function calculateDailyMacros(meals) {
  const sanitizeNumber = (val) => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const s = String(val).trim().replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const res = (meals || []).reduce((acc, meal) => {
    acc.kcal += sanitizeNumber(meal.kcal);
    acc.protein += sanitizeNumber(meal.protein);
    acc.carbs += sanitizeNumber(meal.carbs);
    acc.fat += sanitizeNumber(meal.fat);
    return acc;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });

  return {
    kcal: Math.round(res.kcal),
    protein: Number(res.protein.toFixed(1)),
    carbs: Number(res.carbs.toFixed(1)),
    fat: Number(res.fat.toFixed(1))
  };
}

export function hasMealsForDate(user, dateStr) {
  const meals = getMealsForDate(user, dateStr);
  return meals && meals.length > 0;
}

export { QUICK_PRESETS, HERBALIFE_PRODUCTS };

// Utility to safely check if an image is a valid remote URL or data URI
// Broken/missing local asset paths like 'assets/images/...' are not loaded to prevent 404 network errors
export function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/');
}

// Safe thumbnail renderer with immediate fallback badge
export function renderFoodThumbnailHtml(item, fallbackIcon = '🍽️') {
  const icon = item?.icon || fallbackIcon;
  if (item?.image && isValidImageUrl(item.image)) {
    return `
      <img
        src="${item.image}"
        alt="${item.name || ''}"
        class="food-thumbnail-img w-full h-full object-cover"
        loading="lazy"
        onerror="this.remove(); const fb = this.parentElement?.querySelector('.food-thumbnail-fallback'); if(fb) fb.classList.remove('hidden');"
      />
      <span class="hidden food-thumbnail-fallback text-2xl select-none">${icon}</span>
    `;
  }
  return `<span class="food-thumbnail-fallback text-2xl select-none">${icon}</span>`;
}

// Single-Item Building Blocks with Calibrated Base Values
export const SINGLE_ITEM_BUILDING_BLOCKS = [
  {
    id: 'olive_oil_tsp',
    name: 'כפית שמן זית (5 מ״ל)',
    unitName: 'כפית',
    unitNamePlural: 'כפיות',
    baseAmount: 1,
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
    id: 'bread_slice_40g',
    name: 'פרוסת לחם (40 גרם)',
    unitName: 'פרוסה',
    unitNamePlural: 'פרוסות',
    baseAmount: 1,
    kcal: 100,
    protein: 3.8,
    carbs: 18.0,
    fat: 1.2,
    icon: '🍞',
    image: null,
    badge: '40 גרם לפרוסה'
  },
  {
    id: 'pita_angel_118g',
    name: 'פיתה שווארמה אנג׳ל (118 גרם)',
    unitName: 'פיתה',
    unitNamePlural: 'פיתות',
    baseAmount: 1,
    kcal: 278,
    protein: 9.2,
    carbs: 55.0,
    fat: 1.7,
    icon: '🫓',
    image: null,
    badge: '118 גרם ליחידה',
    toast: 'פיתה אנג׳ל נוספה ליומן! ✓'
  },
  {
    id: 'peanuts_30g',
    name: 'בוטנים קלויים (30 גרם)',
    unitName: 'מנה',
    unitNamePlural: 'מנות',
    baseAmount: 1,
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
    id: 'cream_cheese_tbsp',
    name: 'כף גבינת שמנת',
    unitName: 'כף',
    unitNamePlural: 'כפות',
    baseAmount: 1,
    kcal: 60,
    protein: 2.2,
    carbs: 1.0,
    fat: 5.5,
    icon: '🧀',
    image: null,
    badge: 'מנה מדודה'
  },
  {
    id: 'egg_large',
    name: 'ביצה L',
    unitName: 'ביצה',
    unitNamePlural: 'ביצים',
    baseAmount: 1,
    kcal: 78,
    protein: 6.5,
    carbs: 0.5,
    fat: 5.3,
    icon: '🥚',
    image: null,
    badge: 'ביצה גדולה L'
  },
  {
    id: 'cottage_5_tbsp',
    name: 'כף קוטג׳ 5% (30 גרם)',
    unitName: 'כף',
    unitNamePlural: 'כפות',
    baseAmount: 1,
    kcal: 27,
    protein: 3.3,
    carbs: 0.6,
    fat: 1.5,
    icon: '🥣',
    image: null,
    badge: 'קוטג׳ 5% (30g)'
  },
  {
    id: 'cottage_5_tub',
    name: 'גביע קוטג׳ 5% (250 גרם)',
    unitName: 'גביע',
    unitNamePlural: 'גביעים',
    baseAmount: 1,
    kcal: 225,
    protein: 27.5,
    carbs: 5.0,
    fat: 12.5,
    icon: '🥣',
    image: null,
    badge: 'גביע שלם (250g)'
  },
  {
    id: 'cottage_9_tbsp',
    name: 'כף קוטג׳ 9% (30 גרם)',
    unitName: 'כף',
    unitNamePlural: 'כפות',
    baseAmount: 1,
    kcal: 38,
    protein: 3.0,
    carbs: 0.6,
    fat: 2.7,
    icon: '🥣',
    image: null,
    badge: 'קוטג׳ 9% (30g)'
  },
  {
    id: 'cottage_9_tub',
    name: 'גביע קוטג׳ 9% (250 גרם)',
    unitName: 'גביע',
    unitNamePlural: 'גביעים',
    baseAmount: 1,
    kcal: 315,
    protein: 25.0,
    carbs: 5.0,
    fat: 22.5,
    icon: '🥣',
    image: null,
    badge: 'גביע שלם (250g)'
  }
];

export function logSingleItemBuildingBlock(itemId, quantity = 1, user = 'Arik', dateStr = null) {
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  const item = SINGLE_ITEM_BUILDING_BLOCKS.find(i => i.id === itemId);
  if (!item) return null;

  const rawQty = typeof quantity === 'string' ? quantity.trim().replace(',', '.') : quantity;
  const parsedQty = parseFloat(rawQty);
  const count = Math.max(1, isNaN(parsedQty) ? 1 : parsedQty);
  const totalKcal = Math.round(item.kcal * count);
  const totalProtein = Number((item.protein * count).toFixed(1));
  const totalCarbs = Number((item.carbs * count).toFixed(1));
  const totalFat = Number((item.fat * count).toFixed(1));

  const unitLabel = count === 1 ? item.unitName : (item.unitNamePlural || item.unitName);
  const mealName = count === 1 ? item.name : `${count} ${unitLabel} ${item.name.replace(/^\S+\s*/, '')}`;

  const meal = {
    id: 'single_item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    name: mealName,
    recipe: `${count} × (${item.kcal} kcal, ${item.protein}g חלבון, ${item.carbs}g פח', ${item.fat}g שומן)`,
    kcal: totalKcal,
    protein: totalProtein,
    carbs: totalCarbs,
    fat: totalFat,
    isBuildingBlock: true,
    timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  };

  return saveMeal(user, targetDate, meal);
}

export function logOliveOil(quantity = 1, user = 'Arik', dateStr = null) {
  return logSingleItemBuildingBlock('olive_oil_tsp', quantity, user, dateStr);
}

export function logPitaAngel(quantity = 1, user = 'Arik', dateStr = null) {
  return logSingleItemBuildingBlock('pita_angel_118g', quantity, user, dateStr);
}

export function logQuickPreset(presetId, user = 'Arik', dateStr = null) {
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  const preset = QUICK_PRESETS.find(p => p.id === presetId);
  if (!preset) return null;
  const meal = {
    id: 'preset_' + Date.now(),
    name: preset.name,
    recipe: preset.recipe || '',
    kcal: preset.kcal,
    protein: preset.protein,
    carbs: preset.carbs,
    fat: preset.fat,
    timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  };
  return saveMeal(user, targetDate, meal);
}

export function logSmokedSalmon(user = 'Arik', dateStr = null) {
  return logQuickPreset('smoked_salmon_100g', user, dateStr);
}

export function logPeanuts(user = 'Arik', dateStr = null) {
  return logQuickPreset('peanuts_30g', user, dateStr);
}

export function logTobleroneWhite(user = 'Arik', dateStr = null) {
  return logQuickPreset('toblerone_white_8g', user, dateStr);
}

export function logTobleroneMilkNuts(user = 'Arik', dateStr = null) {
  return logQuickPreset('toblerone_milk_nuts_8g', user, dateStr);
}

export function logHerbalifeProduct(productId, user = 'Arik', dateStr = null) {
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  const product = HERBALIFE_PRODUCTS.find(p => p.id === productId);
  if (!product) return null;
  const meal = {
    id: 'herbalife_prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    name: product.name,
    recipe: product.recipe || '',
    kcal: product.kcal,
    protein: product.protein,
    carbs: product.carbs,
    fat: product.fat,
    isHerbalifeProduct: true,
    timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  };
  return saveMeal(user, targetDate, meal);
}


