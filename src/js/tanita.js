import { STORAGE_KEYS, recalculateProfileFromTanita } from './config.js';
import { getStoredItem, setStoredItem } from './storage.js';
import { state } from './state.js';
import { syncTanitaEntryToCloud, deleteTanitaEntryFromCloud } from './firebase.js';

export const BODY_TYPE_LABELS = {
  1: 'שמנות חבויה (Hidden Obese)',
  2: 'שמנות (Obese)',
  3: 'מבנה מוצק (Solidly Built)',
  4: 'חוסר אימון (Under-exercised)',
  5: 'סטנדרטי (Standard)',
  6: 'סטנדרטי שרירי (Standard Muscular)',
  7: 'רזה (Thin)',
  8: 'רזה ושרירי (Thin & Muscular)',
  9: 'שרירי מאוד (Very Muscular)',
};

export const TANITA_METRIC_CONFIGS = [
  { key: 'weight', name: 'משקל גוף', shortName: 'משקל', unit: 'ק"ג', icon: 'scale', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.12)', desc: 'משקל גוף כולל', step: 0.1, lowerIsBetter: true },
  { key: 'bmi', name: 'מדד מסת גוף BMI', shortName: 'BMI', unit: '', icon: 'gauge', color: '#0284c7', bgColor: 'rgba(2, 132, 199, 0.12)', desc: 'יחס משקל לגובה בריבוע', step: 0.1, lowerIsBetter: true },
  { key: 'bodyFat', name: 'אחוז שומן', shortName: '% שומן', unit: '%', icon: 'percent', color: '#f43f5e', bgColor: 'rgba(244, 63, 94, 0.12)', desc: 'אחוז שומן מכלל הגוף', step: 0.1, lowerIsBetter: true },
  { key: 'muscleKg', name: 'מסת שריר', shortName: 'שריר', unit: 'ק"ג', icon: 'dumbbell', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.12)', desc: 'מסת שריר שלד', step: 0.1, lowerIsBetter: false },
  { key: 'visceralFat', name: 'שומן ויסצראלי', shortName: 'ויסצראלי', unit: 'רמה', icon: 'flame', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.12)', desc: 'שומן תוך בטני (יעד ≤5)', step: 0.5, lowerIsBetter: true },
  { key: 'boneMass', name: 'מסת עצם', shortName: 'מסת עצם', unit: 'ק"ג', icon: 'activity', color: '#64748b', bgColor: 'rgba(100, 116, 139, 0.12)', desc: 'משקל מינרלים בעצמות', step: 0.05, lowerIsBetter: false },
  { key: 'bmr', name: 'חילוף חומרים BMR', shortName: 'BMR', unit: 'kcal', icon: 'zap', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.12)', desc: 'שריפת קלוריות בסיסית במנוחה', step: 10, lowerIsBetter: false },
  { key: 'waterPct', name: 'אחוז נוזלים ומים', shortName: '% נוזלים', unit: '%', icon: 'droplet', color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.12)', desc: 'אחוז מים כולל בגוף', step: 0.1, lowerIsBetter: false },
  { key: 'metabolicAge', name: 'גיל מטבולי', shortName: 'גיל מטבולי', unit: 'שנים', icon: 'calendar', color: '#d946ef', bgColor: 'rgba(217, 70, 239, 0.12)', desc: 'גיל ביולוגי משוער', step: 1, lowerIsBetter: true },
  { key: 'muscleQuality', name: 'איכות שריר MQ', shortName: 'איכות שריר', unit: 'MQ', icon: 'shield-check', color: '#6366f1', bgColor: 'rgba(99, 102, 241, 0.12)', desc: 'ציון איכות וצפיפות רקמת שריר', step: 1, lowerIsBetter: false },
  { key: 'bodyType', name: 'דירוג מבנה גוף', shortName: 'מבנה גוף', unit: 'דירוג', icon: 'user-check', color: '#14b8a6', bgColor: 'rgba(20, 184, 166, 0.12)', desc: 'פרופיל מבנה גוף (1 עד 9)', step: 1, lowerIsBetter: false }
];

export const TANITA_METRIC_INFO = {
  weight: {
    title: 'משקל גוף (Body Weight)',
    unit: 'ק"ג (kg)',
    icon: 'scale',
    color: '#10b981',
    category: 'מדד הרכב בסיסי',
    whatIsIt: 'משקל הגוף הכולל בקילוגרמים. מורכב מרקמת שומן, שרירי שלד, עצמות, נוזלים, דם ואיברים פנימיים.',
    norms: 'משקל הגוף הבריא מותאם לגובה ולמבנה השלד (ראו מדד BMI). תנודות יומיות של ±0.5 עד ±1.5 ק"ג הן טבעיות לחלוטין ומשקפות אגירת מים, מלחים, ומזון במערכת העיכול.',
    healthImpact: 'המשקל לבדו אינו מספר את הסיפור המלא. היעד האמיתי בחיטוב הוא ירידה מבוקרת (0.5%-1% ממשקל הגוף לשבוע) המבטיחה שריפת שומן תוך שימור או עלייה במסת השריר.',
    recommendations: [
      'הישקל תמיד בבוקר בצום, לאחר התרוקנות בשירותים ולפני שתייה או פעילות גופנית.',
      'עקוב אחר המגמה השבועית והחודשית ולא אחר שינוי ביום בודד.',
      'בחן תמיד את המשקל לצד אחוז השומן ומסת השריר.'
    ]
  },
  bmi: {
    title: 'מדד מסת גוף (BMI - Body Mass Index)',
    unit: 'מדד יחס',
    icon: 'gauge',
    color: '#0284c7',
    category: 'יחס משקל לגובה',
    whatIsIt: 'נוסחת תקן בינלאומית של ארגון הבריאות העולמי: משקל הגוף (ק"ג) מחולק בגובה בריבוע (במטרים).',
    norms: 'פחות מ-18.5: תת-משקל | 18.5 - 24.9: טווח תקין ובריא | 25.0 - 29.9: עודף משקל סטטיסטי | 30.0+: השמנה.',
    healthImpact: 'מדד סטטיסטי כללי המאפשר אומדן ראשוני. למתאמנים בעלי מסת שריר גבוהה, BMI עלול להיות מוגבה (מעל 25) למרות שהם חטובים ובריאים לחלוטין.',
    recommendations: [
      'למתאמנים: הצלב את ה-BMI עם אחוז השומן והשומן הויסצראלי.',
      'אם ה-BMI מעל 25 אך אחוז השומן תקין או נמוך — המצב מצוין ושרירי.',
      'שמירה על BMI מאוזן מגינה על הלב, כלי הדם והמפרקים.'
    ]
  },
  bodyFat: {
    title: 'אחוז שומן (Body Fat %)',
    unit: '% מסך המשקל',
    icon: 'percent',
    color: '#f43f5e',
    category: 'הרכב רקמת שומן',
    whatIsIt: 'אחוז רקמת השומן (התת-עורית והקרבית) מתוך סך כל משקל הגוף.',
    norms: 'גברים: 6%-13% (חיטוב גבוה/אתלטי), 14%-17% (כושר מעולה ובריא), 18%-24% (סטנדרטי תקין), 25%+ (עודף שומן). נשים: 14%-20% (אתלטי), 21%-24% (כושר גבוה), 25%-31% (תקין ומאוזן), 32%+ (עודף שומן).',
    healthImpact: 'אחוז שומן גבוה מעלה עמידות לאינסולין, דלקתיות וסיכון קרדיווסקולרי. אחוז שומן נמוך מדי עלול לפגוע במערכת ההורמונלית.',
    recommendations: [
      'גרעון קלורי מתון (300-500 קלוריות) שומר על קצב ירידה בטוח בשומן ללא פירוק שריר.',
      'הקפד על צריכת חלבון גבוהה (1.6 עד 2.2 גרם לק"ג משקל גוף).',
      'שלב אימוני כוח עצימים 2-4 פעמים בשבוע.'
    ]
  },
  muscleKg: {
    title: 'מסת שריר (Muscle Mass)',
    unit: 'ק"ג (kg)',
    icon: 'dumbbell',
    color: '#3b82f6',
    category: 'מסת שריר שלד',
    whatIsIt: 'משקל שרירי השלד, השרירים החלקים (שריר הלב ודפנות איברים) והנוזלים האגורים בהם.',
    norms: 'גברים: כ-75%-85% מסך המשקל (מסת שריר 50-65 ק"ג). נשים: כ-65%-75% מסך המשקל (מסת שריר 38-48 ק"ג), בהתאם לגובה.',
    healthImpact: 'השריר הוא מנוע שריפת האנרגיה הראשי בגוף. כל קילוגרם שריר מעלה את ה-BMR במנוחה, משפר רגישות לאינסולין, מחזק עצמות ומעכב הזדקנות ביולוגית.',
    recommendations: [
      'אימוני כוח בשיטת עומס יסף מתקדם (Progressive Overload) הם הגירוי היעיל ביותר.',
      'פזר את צריכת החלבון ל-3-5 ארוחות יומיות (25-40 גרם חלבון לארוחה).',
      'שינה איכותית של 7-8 שעות בלילה חיונית לסינתזת שריר והפרשת הורמון גדילה.'
    ]
  },
  visceralFat: {
    title: 'שומן ויסצראלי ⭐ (Visceral Fat)',
    unit: 'רמה (1-15)',
    icon: 'flame',
    color: '#f59e0b',
    category: 'מדד קליני קריטי',
    whatIsIt: 'שומן תוך-בטני עמוק העוטף את האיברים הפנימיים החיוניים (כבד, לבלב ומעיים). בניגוד לשומן תת-עורי רגיל, שומן ויסצראלי הוא פעיל מטבולית ומפריש חומרים דלקתיים.',
    norms: 'רמות 1 עד 5: מעולה ותקין לחלוטין (רמת סיכון נמוכה ביותר). רמות 6 עד 9: גבול עליון תקין (מומלץ לנטר ולשפר). רמות 10 עד 14: רמת סיכון מוגברת. רמה 15 ומעלה: סיכון קליני גבוה.',
    healthImpact: 'המדד החשוב ביותר למניעת כבד שומני, סוכרת סוג 2, מחלות לב וטרשת עורקים. ירידה של נקודה אחת ברמת השומן הויסצראלי מעניקה רווח בריאותי עצום!',
    recommendations: [
      'הימנע מסוכרים פשוטים, משקאות ממותקים, אלכוהול ושומן מעובד.',
      'הקפד על פעילות אירובית קלה/בינונית (Zone 2) ו-8,000-10,000 צעדים ביום.',
      'הפחת סטרס וקורטיזול: מתח נפשי כרוני מעודד אגירת שומן בטני עמוק.'
    ]
  },
  boneMass: {
    title: 'מסת עצם (Bone Mass)',
    unit: 'ק"ג (kg)',
    icon: 'activity',
    color: '#64748b',
    category: 'מינרלים ושלד',
    whatIsIt: 'משקל המינרלים (סידן, זרחן ותרכובות סידניות) המרכיבים את שלד העצמות בגוף.',
    norms: 'גברים: 2.5 עד 3.4 ק"ג (בהתאם למשקל ולגובה). נשים: 1.9 עד 2.8 ק"ג.',
    healthImpact: 'צפיפות ומסת עצם תקינות מונעות שברים, נקעים ואוסטאופורוזיס בגיל מבוגר.',
    recommendations: [
      'אימוני התנגדות וכוח המעמיסים על השלד מעודדים צפיפות מינרלים בעצמות.',
      'צרוך כמות נאותה של סידן במזון (מוצרי חלב, סרדינים, טופו, שקדים, עלים ירוקים).',
      'ודא רמות תקינות של ויטמין D3 וספוג שמש מתונה לספיגה מיטבית של סידן.'
    ]
  },
  bmr: {
    title: 'חילוף חומרים בסיסי (BMR)',
    unit: 'קלוריות (kcal)',
    icon: 'zap',
    color: '#8b5cf6',
    category: 'הוצאת אנרגיה במנוחה',
    whatIsIt: 'מספר הקלוריות המינימלי שהגוף שורף ב-24 שעות של מנוחה מוחלטת לתפקוד מערכות החיים (נשימה, זרימת דם, תפקוד כליות, מוח וחידוש תאים).',
    norms: 'גברים: 1,500 - 2,000 קק"ל | נשים: 1,200 - 1,600 קק"ל (משתנה לפי גיל, משקל ומסת שריר).',
    healthImpact: 'מהווה כ-60%-70% מסך ההוצאה הקלורית היומית שלך. ככל שמסת השריר גדולה יותר, ה-BMR עולה והגוף שורף יותר אנרגיה סביב השעון.',
    recommendations: [
      'לעולם אל תצרוך לאורך זמן פחות קלוריות מערך ה-BMR שלך! גרעון קיצוני מאט את חילוף החומרים ומפרק שרירים.',
      'הדרך האמינה ביותר להעלות את ה-BMR היא בניית שריר באמצעות אימוני כוח.',
      'הימנע מדיאטות הרעבה שמרסקות את המטבוליזם.'
    ]
  },
  waterPct: {
    title: 'אחוז נוזלים ומים בגוף (Body Water %)',
    unit: '% מסך המשקל',
    icon: 'droplet',
    color: '#06b6d4',
    category: 'הידרציה תאית',
    whatIsIt: 'אחוז המים הכולל בגוף (בתוך התאים ומחוצה להם). מים מהווים כ-75% מרקמת השריר אך רק כ-10% מרקמת השומן.',
    norms: 'גברים: 50% עד 65% | נשים: 45% עד 60%.',
    healthImpact: 'מים חיוניים להובלת חומרי מזון, ויסות טמפרטורה, תפקוד כליות וגמישות מפרקים. התייבשות קלה פוגעת בריכוז ובביצועי אימון.',
    recommendations: [
      'שתה 2.5 עד 3.5 ליטר מים ביום, ועוד 500-1000 מ"ל סביב אימונים.',
      'שקילה בימי מחסור בנוזלים תציג לעיתים ירידה מדומה במסת השריר הנובעת מחוסר מים בתאים.',
      'הקפד על מאזן מלחים ואלקטרוליטים (נתרן, אשלגן, מגנזיום).'
    ]
  },
  metabolicAge: {
    title: 'גיל מטבולי (Metabolic Age)',
    unit: 'שנים',
    icon: 'calendar',
    color: '#d946ef',
    category: 'כושר ביולוגי משוער',
    whatIsIt: 'השוואת ה-BMR והרכב הגוף שלך לממוצע הסטטיסטי של קבוצות גיל שונות באוכלוסייה.',
    norms: 'גיל מטבולי נמוך מהגיל הכרונולוגי: מעולה! הגוף שורף קלוריות ובעל הרכב גוף כמו של אדם צעיר יותר. גיל מטבולי גבוה מהגיל: מעיד על צורך בהגדלת שריר והורדת שומן.',
    healthImpact: 'משמש כמדד מוטיבציה מעולה לשיפור איכות החיים והכושר הביולוגי הכללי.',
    recommendations: [
      'העלאת מסת שריר והורדת שומן ויסצראלי הן הדרך המהירה ביותר להצערת הגיל המטבולי.',
      'שילוב אימוני התנגדות ופעילות אירובית עקבית מוריד את הגיל המטבולי תוך חודשים ספורים.',
      'תזונה עשירה בחלבון ומזון אמיתי מאיצה את השיפור.'
    ]
  },
  muscleQuality: {
    title: 'איכות שריר (Muscle Quality - MQ)',
    unit: 'ציון MQ',
    icon: 'shield-check',
    color: '#6366f1',
    category: 'צפיפות ומבנה רקמה',
    whatIsIt: 'מדד בלעדי ומתקדם של מכשירי Tanita Dual Frequency, הבודק את המבנה הפנימי וצפיפות רקמת השריר ברמת התא (איכות ולא רק נפח חיצוני).',
    norms: 'מתחת ל-50: איכות שריר נמוכה | 50 עד 74: איכות שריר ממוצעת/טובה | 75 ומעלה: איכות שריר גבוהה מאוד (אופייני למתאמנים סדירים).',
    healthImpact: 'רקמת שריר איכותית מכילה יותר סיבי שריר בריאים ופחות שומן תוך-שרירי. מספקת כוח מתפרץ, יציבות מפרקית והתאוששות מהירה.',
    recommendations: [
      'בצע אימוני כוח עצימים הדורשים גיוס יחידות מוטוריות גבוהות.',
      'התמקד בטווח של 6-12 חזרות בקרבה לכשל (RPE 8-9).',
      'התאוששות מספקת וצריכת חלבון משפרות את צפיפות סיבי השריר.'
    ]
  },
  bodyType: {
    title: 'דירוג מבנה גוף (Body Type 1-9)',
    unit: 'פרופיל (1-9)',
    icon: 'user-check',
    color: '#14b8a6',
    category: 'סיווג מטריצה הרכבית',
    whatIsIt: 'מטריצה דו-ממדית של 9 פרופילים המחברת את רמת מסת השריר לעומת אחוז השומן בגוף.',
    norms: '1: שמנות חבויה | 2: שמנות | 3: מבנה מוצק | 4: חוסר אימון | 5: סטנדרטי | 6: סטנדרטי שרירי | 7: רזה | 8: רזה ושרירי | 9: שרירי מאוד.',
    healthImpact: 'מאפשר לראות את כיוון השינוי הגופני האמיתי שלך מעבר למשקל הבסיסי.',
    recommendations: [
      'היעד המרכזי למתאמנים בחיטוב: התקדמות לכיוון פרופילים 6, 8 או 9.',
      'גם כאשר המשקל על המאזניים נשאר יציב, מעבר מפרופיל 4 ל-5 או ל-6 מעיד על שינוי הרכב גוף נפלא (Recomposition).'
    ]
  },
  combined: {
    title: 'תרשים משולב רב-מדדי (Multi-Line Chart)',
    unit: '11 מדדים יחד',
    icon: 'layers',
    color: '#6366f1',
    category: 'ניתוח רב-מדדי משולב',
    whatIsIt: 'תרשים מקיף המרכז את כל 11 מדדי הטניטה על ציר זמן רציף יחיד. מאפשר לראות את הקשרים הדינמיים בין ירידה במשקל, שינוי באחוז שומן, שימור שריר ושומן ויסצראלי.',
    norms: 'באפשרותך לעבור בין "ערכים מקוריים" לבין "מגמת שינוי % יחסית" המנרמלת את כל המדדים לקו בסיס של 0% להשוואת קצב ההתקדמות המדויק.',
    healthImpact: 'מבט-על הוליסטי על מסע הכושר והבריאות שלך, שמונע התמקדות מוטעית במדד בודד ומציג את התמונה השלמה.',
    recommendations: [
      'לחץ על המדדים ברצועת הסינון כדי להסתיר או להציג קווים ספציפיים (למשל: לבודד שומן מול שריר).',
      'השתמש במצב "מגמת שינוי %" כדי לראות אם אחוז השומן יורד בקצב מהיר יותר מהמשקל (סימן מובהק לחיטוב איכותי).',
      'בדוק שמסת השריר נשארת יציבה (קו אופקי או עולה) במקביל לירידה בשומן הויסצראלי.'
    ]
  },
  weight_muscle: {
    title: 'משקל ומסת שריר (Dual-Axis Weight & Muscle)',
    unit: 'ק"ג (kg)',
    icon: 'scale',
    color: '#10b981',
    category: 'ציר כפול',
    whatIsIt: 'השוואה ישירה של סך משקל הגוף (ציר ירוק שמאלי) לעומת מסת השריר (ציר כחול ימני).',
    norms: 'התרחיש האופטימלי בחיטוב: קו המשקל יורד בעוד קו מסת השריר שומר על גובהו או עולה קלות.',
    healthImpact: 'המדד המובהק ביותר לשמירה על חילוף החומרים ומניעת פגיעה ברקמת שריר במהלך ירידה במשקל.',
    recommendations: [
      'אם קו השריר יורד יחד עם המשקל: הגדל צריכת חלבון והפחת את הגירעון הקלורי.',
      'שמור על אימוני כוח עצימים 2-4 פעמים בשבוע.'
    ]
  },
  visceral_fat: {
    title: 'שומן ויסצראלי מול % שומן (Visceral & Body Fat %)',
    unit: 'רמה / %',
    icon: 'flame',
    color: '#f59e0b',
    category: 'ציר כפול',
    whatIsIt: 'מעקב משולב אחר השומן התוך-בטני העמוק (רמה 1-15) יחד עם אחוז השומן הכללי בגוף.',
    norms: 'יעד שומן ויסצראלי: רמה 5 ומטה. יעד % שומן: 12-16% בגברים, 20-24% בנשים.',
    healthImpact: 'שני המדדים המרכזיים המשקפים בריאות מטבולית, מניעת כבד שומני ושיפור איכות החיים.',
    recommendations: [
      'הפחת מזונות אולטרה-מעובדים, אלכוהול וסוכרים.',
      'הקפד על 8,000-10,000 צעדים ביום ואימונים סדירים.'
    ]
  }
};

/**
 * Robust regex parser for raw My Tanita text exports/pastes.
 * Extracts ALL 11 official Tanita metrics:
 * 1) Weight (משקל - kg)
 * 2) BMI (מדד מסת גוף)
 * 3) Body fat (אחוז שומן - %)
 * 4) Muscle mass (מסת שריר - kg)
 * 5) Bone mass (מסת עצם - kg)
 * 6) BMR (חילוף חומרים בסיסי - kcal)
 * 7) Body water (נוזלים - %)
 * 8) Metabolic Age (גיל מטבולי - years)
 * 9) Visceral fat (שומן ויסצרלי/בטני)
 * 10) Muscle quality (איכות שריר - mq)
 * 11) Body type (מבנה גוף - 1-9)
 */
export function parseTanitaText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  const cleanText = rawText.trim();
  if (!cleanText) return null;

  // Helper to extract numeric values following patterns
  const extractNumber = (patterns) => {
    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match && match[1]) {
        let numStr = match[1].trim();
        // If it's something like 70,5 or 15,8 (comma as decimal point), convert to 70.5
        if (/^\d+,\d{1,2}$/.test(numStr)) {
          numStr = numStr.replace(',', '.');
        } else {
          numStr = numStr.replace(/,/g, '');
        }
        const num = parseFloat(numStr);
        if (!isNaN(num)) {
          return num;
        }
      }
    }
    return null;
  };

  // 1. Weight (kg)
  const weight = extractNumber([
    /(?:weight|משקל)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:kg|ק"?ג)?/i,
    /([\d,]+(?:\.\d+)?)\s*(?:kg|ק"?ג)\b/i,
    /משקל\s+([\d,]+(?:\.\d+)?)/i
  ]);

  // 2. BMI (Body Mass Index)
  const bmi = extractNumber([
    /(?:bmi|מדד\s*מסת\s*(?:ה)?גוף|אינדקס\s*מסת\s*(?:ה)?גוף)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    /\bbmi\b\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i
  ]);

  // 3. Body Fat (%)
  const bodyFat = extractNumber([
    /(?:body\s*fat|fat|אחוז\s*שומן|שומן\s*כללי|שומן)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*%/i,
    /%\s*(?:fat|שומן)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    /(?:body\s*fat)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    /אחוז\s*שומן\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i
  ]);

  // 4. Muscle Mass (kg)
  const muscleMass = extractNumber([
    /(?:muscle\s*mass|muscle|מסת\s*שריר|שריר)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:kg|ק"?ג)?/i,
    /מסת\s*שריר\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i
  ]);

  // 5. Bone Mass (kg)
  const boneMass = extractNumber([
    /(?:bone\s*mass|bone|מסת\s*עצם|עצם)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:kg|ק"?ג)?/i,
    /מסת\s*עצם\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i
  ]);

  // 6. BMR (kcal)
  const bmr = extractNumber([
    /(?:bmr|חילוף\s*חומרים\s*בסיסי|בזאלי|קצב\s*חילוף\s*חומרים)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:kcal|קלוריות)?/i,
    /(?:bmr)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    /([\d,]+)\s*(?:kcal|קלוריות)\s*bmr/i
  ]);

  // 7. Body Water (%)
  const bodyWater = extractNumber([
    /(?:body\s*water|water|tbw|נוזלים|מים\s*בגוף|מים)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*%/i,
    /(?:body\s*water|water|tbw|מים\s*בגוף|נוזלים)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i
  ]);

  // 8. Metabolic Age (Years)
  const metabolicAge = extractNumber([
    /(?:metabolic\s*age|גיל\s*מטבולי)\s*[:=]?\s*([\d]+)/i,
    /גיל\s*מטבולי\s*[:=]?\s*([\d]+)/i
  ]);

  // 9. Visceral Fat (Rating / Level 1-15)
  const visceralFat = extractNumber([
    /(?:visceral\s*fat|visceral|שומן\s*ויסצראלי|שומן\s*ויסצרלי|שומן\s*בטני|ויסצראלי|ויסצרלי)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    /דרגת\s*שומן\s*(?:בטני|ויסצראלי|ויסצרלי)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i
  ]);

  // 10. Muscle Quality (Score / mq)
  const muscleQuality = extractNumber([
    /(?:muscle\s*quality|muscle\s*score|איכות\s*שריר|ציון\s*שריר)\s*[:=]?\s*([\d]+)/i,
    /([\d]+)\s*(?:mq|איכות\s*שריר)/i
  ]);

  // 11. Body Type (Physique Rating 1-9)
  const bodyType = extractNumber([
    /(?:body\s*type|physique\s*rating|physique|מבנה\s*גוף|דירוג\s*מבנה\s*גוף|טיפוס\s*גוף)\s*[:=]?\s*([\d]+)/i
  ]);

  const hasAtLeastOne = weight !== null || bodyFat !== null || visceralFat !== null || muscleMass !== null || bmr !== null || bmi !== null;
  if (!hasAtLeastOne) {
    return null;
  }

  return {
    weight: weight !== null ? Number(weight.toFixed(1)) : null,
    bmi: bmi !== null ? Number(bmi.toFixed(1)) : null,
    bodyFat: bodyFat !== null ? Number(bodyFat.toFixed(1)) : null,
    muscleKg: muscleMass !== null ? Number(muscleMass.toFixed(2)) : null,
    boneMass: boneMass !== null ? Number(boneMass.toFixed(2)) : null,
    bmr: bmr !== null ? Math.round(bmr) : null,
    waterPct: bodyWater !== null ? Number(bodyWater.toFixed(1)) : null,
    metabolicAge: metabolicAge !== null ? Math.round(metabolicAge) : null,
    visceralFat: visceralFat !== null ? Number(visceralFat.toFixed(1)) : null,
    muscleQuality: muscleQuality !== null ? Math.round(muscleQuality) : null,
    bodyType: bodyType !== null ? Math.round(bodyType) : null,
    rawText: cleanText
  };
}

const DEFAULT_SAMPLE_TANITA = {
  Arik: [
    {
      id: 'tanita_arik_seed_1',
      date: '2026-09-18',
      weight: 70.0,
      bmi: 23.1,
      bodyFat: 15.8,
      muscleKg: 56.40,
      boneMass: 3.10,
      bmr: 1650,
      waterPct: 55.4,
      metabolicAge: 29,
      visceralFat: 5.5,
      muscleQuality: 68,
      bodyType: 6,
      source: 'smart_paste'
    },
    {
      id: 'tanita_arik_seed_2',
      date: '2026-09-11',
      weight: 70.8,
      bmi: 23.4,
      bodyFat: 16.5,
      muscleKg: 56.10,
      boneMass: 3.08,
      bmr: 1640,
      waterPct: 54.8,
      metabolicAge: 30,
      visceralFat: 6.0,
      muscleQuality: 66,
      bodyType: 6,
      source: 'smart_paste'
    },
    {
      id: 'tanita_arik_seed_3',
      date: '2026-09-04',
      weight: 71.5,
      bmi: 23.6,
      bodyFat: 17.2,
      muscleKg: 55.80,
      boneMass: 3.05,
      bmr: 1630,
      waterPct: 54.2,
      metabolicAge: 31,
      visceralFat: 6.5,
      muscleQuality: 65,
      bodyType: 5,
      source: 'smart_paste'
    }
  ],
  Granit: [
    {
      id: 'tanita_granit_seed_1',
      date: '2026-09-18',
      weight: 56.0,
      bmi: 24.2,
      bodyFat: 21.0,
      muscleKg: 41.50,
      boneMass: 2.30,
      bmr: 1250,
      waterPct: 54.8,
      metabolicAge: 27,
      visceralFat: 3.5,
      muscleQuality: 72,
      bodyType: 5,
      source: 'smart_paste'
    },
    {
      id: 'tanita_granit_seed_2',
      date: '2026-09-11',
      weight: 56.6,
      bmi: 24.5,
      bodyFat: 21.8,
      muscleKg: 41.20,
      boneMass: 2.28,
      bmr: 1245,
      waterPct: 54.2,
      metabolicAge: 28,
      visceralFat: 4.0,
      muscleQuality: 70,
      bodyType: 5,
      source: 'smart_paste'
    },
    {
      id: 'tanita_granit_seed_3',
      date: '2026-09-04',
      weight: 57.2,
      bmi: 24.8,
      bodyFat: 22.5,
      muscleKg: 40.90,
      boneMass: 2.26,
      bmr: 1240,
      waterPct: 53.6,
      metabolicAge: 28,
      visceralFat: 4.5,
      muscleQuality: 69,
      bodyType: 4,
      source: 'smart_paste'
    }
  ]
};

export function getTanitaHistory(user) {
  const key = `${STORAGE_KEYS.TANITA_PREFIX}${user}`;
  const initKey = `ag_tanita_initialized_${user}`;
  const isInitialized = getStoredItem(initKey, false);
  const history = getStoredItem(key, null);

  // Only seed sample data on the very first fresh run if never initialized
  if (history === null && !isInitialized) {
    const seed = DEFAULT_SAMPLE_TANITA[user] || DEFAULT_SAMPLE_TANITA.Arik;
    setStoredItem(key, seed);
    setStoredItem(initKey, true);
    return seed;
  }
  return Array.isArray(history) ? history : [];
}

export function getLatestTanitaEntry(user) {
  const history = getTanitaHistory(user);
  return history && history.length > 0 ? history[0] : null;
}

export function saveTanitaEntry(user, entry) {
  const key = `${STORAGE_KEYS.TANITA_PREFIX}${user}`;
  const initKey = `ag_tanita_initialized_${user}`;
  setStoredItem(initKey, true);
  const history = getTanitaHistory(user);

  const sanitizeFloat = (val, fallback = null) => {
    if (val === null || val === undefined || val === '') return fallback;
    if (typeof val === 'number') return isNaN(val) ? fallback : val;
    const s = String(val).trim().replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? fallback : n;
  };

  const parsedWeight = sanitizeFloat(entry.weight, 0);

  // Auto calculate BMI if missing and weight + height exist
  let calculatedBmi = sanitizeFloat(entry.bmi, null);
  if (!calculatedBmi && parsedWeight > 0) {
    const heightCm = user === 'Granit' ? 152 : 174;
    calculatedBmi = Number((parsedWeight / Math.pow(heightCm / 100, 2)).toFixed(1));
  }
  
  const newEntry = {
    id: entry.id || ('tanita_' + Date.now()),
    date: entry.date || new Date().toISOString().split('T')[0],
    weight: parsedWeight,
    bmi: calculatedBmi,
    bodyFat: sanitizeFloat(entry.bodyFat, 0),
    muscleKg: sanitizeFloat(entry.muscleKg || entry.muscleMass, 0),
    boneMass: sanitizeFloat(entry.boneMass, 3.0),
    bmr: sanitizeFloat(entry.bmr, user === 'Granit' ? 1250 : 1650),
    waterPct: sanitizeFloat(entry.waterPct || entry.bodyWater, 55.0),
    metabolicAge: sanitizeFloat(entry.metabolicAge, null),
    visceralFat: sanitizeFloat(entry.visceralFat, 1),
    muscleQuality: sanitizeFloat(entry.muscleQuality, null),
    bodyType: sanitizeFloat(entry.bodyType, 5),
    source: entry.source || 'manual',
    rawText: entry.rawText || ''
  };

  const existingIndex = history.findIndex(h => h.date === newEntry.date);
  if (existingIndex >= 0) {
    history[existingIndex] = { ...history[existingIndex], ...newEntry };
  } else {
    history.unshift(newEntry);
  }

  history.sort((a, b) => new Date(b.date) - new Date(a.date));
  setStoredItem(key, history);

  // Recalculate auto-macros based on new Tanita BMR and update current weight
  try {
    recalculateProfileFromTanita(user, newEntry);
  } catch (err) {
    console.warn('Auto-macro recalculation notice:', err);
  }

  // Background Cloud Sync to Firestore: users/{userEmail}/tanita_logs/{newEntry.id}
  try {
    const userEmail = state.getUserEmailKey();
    if (userEmail) {
      syncTanitaEntryToCloud(userEmail, newEntry).catch(err =>
        console.warn('Firestore Tanita log sync warning:', err)
      );
    }
  } catch (err) {
    console.warn('Tanita cloud sync error:', err);
  }

  return newEntry;
}

export function deleteTanitaEntry(user, entryId) {
  const key = `${STORAGE_KEYS.TANITA_PREFIX}${user}`;
  const initKey = `ag_tanita_initialized_${user}`;
  setStoredItem(initKey, true);
  let history = getTanitaHistory(user);
  history = history.filter(h => h.id !== entryId);
  setStoredItem(key, history);

  // Background Cloud Sync
  try {
    const userEmail = state.getUserEmailKey();
    if (userEmail && entryId) {
      deleteTanitaEntryFromCloud(userEmail, entryId).catch(err =>
        console.warn('Firestore Tanita delete warning:', err)
      );
    }
  } catch (err) {
    console.warn('Tanita cloud delete error:', err);
  }

  return history;
}

export function clearAllTanitaHistory(user) {
  const key = `${STORAGE_KEYS.TANITA_PREFIX}${user}`;
  const initKey = `ag_tanita_initialized_${user}`;
  setStoredItem(initKey, true);
  setStoredItem(key, []);
  return [];
}

export function clearAllTanitaAllUsers() {
  ['Arik', 'Granit'].forEach(u => {
    setStoredItem(`ag_tanita_initialized_${u}`, true);
    setStoredItem(`${STORAGE_KEYS.TANITA_PREFIX}${u}`, []);
  });
  return true;
}

export function calculateTanitaTrends(history) {
  if (!history || history.length < 2) {
    return { weightDiff: 0, fatDiff: 0, visceralDiff: 0, muscleDiff: 0, bmrDiff: 0 };
  }
  const latest = history[0];
  const previous = history[history.length - 1];
  return {
    weightDiff: Number((latest.weight - previous.weight).toFixed(1)),
    fatDiff: Number((latest.bodyFat - previous.bodyFat).toFixed(1)),
    visceralDiff: Number((latest.visceralFat - previous.visceralFat).toFixed(1)),
    muscleDiff: Number((latest.muscleKg - previous.muscleKg).toFixed(1)),
    bmrDiff: latest.bmr && previous.bmr ? latest.bmr - previous.bmr : 0,
  };
}
