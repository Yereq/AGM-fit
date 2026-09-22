import { state } from './state.js';
import { getMealsForDate, calculateDailyMacros } from './meals.js';
import { getTanitaHistory } from './tanita.js';
import { getWorkoutForDate, calculateWorkoutBurn } from './workout.js';

export function evaluateCoachingFeedback({ user, profile, macroTotals, workoutBurn, netCalories, tanitaHistory, todayWorkout }) {
  const hebrewName = profile?.hebrewName || (user === 'Arik' ? 'אריק' : 'גרניט');
  const targetKcal = Number(profile?.targetKcal) || (user === 'Arik' ? 1550 : 1250);
  const targetProtein = Number(profile?.targetProtein) || (user === 'Arik' ? 120 : 90);
  const consumedKcal = Number(macroTotals?.kcal) || 0;
  const consumedProtein = Number(macroTotals?.protein) || 0;
  const burn = Number(workoutBurn) || 0;
  const net = netCalories !== undefined ? Number(netCalories) : (consumedKcal - burn);

  // Strict Mathematical Verification:
  const isProteinMet = consumedProtein >= targetProtein;
  const calorieDiff = Number((targetKcal - consumedKcal).toFixed(1));
  const isCalorieUnderOrOnTarget = consumedKcal <= targetKcal;
  const isDangerouslyLowKcal = consumedKcal < 800;
  const isModerateSafeDeficit = calorieDiff >= 100 && calorieDiff <= 250 && isProteinMet;
  const proteinDiff = Number((targetProtein - consumedProtein).toFixed(1));

  // 1. Calorie & Day Evaluation sentence:
  let sentence1 = '';
  if (isProteinMet && isCalorieUnderOrOnTarget && !isDangerouslyLowKcal) {
    sentence1 = 'יום חיטוב מצוין ומדויק. שמרת על חלבון גבוה שיגן על השריר תוך גירעון קלורי קל לשריפת שומן.';
  } else if (isModerateSafeDeficit) {
    sentence1 = `${hebrewName}, אתה נמצא בגרעון קלורי מדויק ובטוח של ${Math.round(calorieDiff)} קק"ל מתחת ליעד, המהווה קצב אידיאלי לירידה ממוקדת בשומן תוך שמירה מלאה על השריר.`;
  } else if (isDangerouslyLowKcal) {
    sentence1 = `${hebrewName}, שים לב שצריכת הקלוריות היומית נמוכה מדי (${Math.round(consumedKcal)} קק"ל, מתחת ל-800 קק"ל) - הקפד על השלמת אנרגיה כדי למנוע עייפות ופגיעה בחילוף החומרים.`;
  } else if (calorieDiff > 250 && !isProteinMet) {
    sentence1 = `${hebrewName}, הגרעון הקלורי עמוק כרגע (${Math.round(calorieDiff)} קק"ל מתחת ליעד) ויעד החלבון טרם הושלם - שים לב להשלמת חלבון איכותי למניעת פירוק שריר.`;
  } else if (consumedKcal > targetKcal + 150) {
    sentence1 = `${hebrewName}, שים לב שסך הקלוריות (${Math.round(consumedKcal)} קק"ל) חורג מעט מהיעד המומלץ (${targetKcal} קק"ל), מומלץ לאזן בארוחה הבאה.`;
  } else {
    sentence1 = `${hebrewName}, המאזן הקלורי עומד על ${Math.round(consumedKcal)} קק"ל ונמצא בדיוק בטווח היעד המומלץ לשיפור הרכב הגוף.`;
  }

  // 2. Protein sentence:
  // Strict Rule: If protein_consumed >= protein_target: praise! NEVER say "עלייך להגיע ליעד החלבון".
  let sentence2 = '';
  if (isProteinMet) {
    sentence2 = `כל הכבוד, הגעת ליעד החלבון (${consumedProtein}g מתוך ${targetProtein}g)! יעד החלבון הושג במלואו ומגן על מסת השריר.`;
  } else if (proteinDiff <= 15) {
    sentence2 = `אתה קרוב מאוד ליעד החלבון: חסרים כ-${proteinDiff}g בלבד להשלמת היעד (${targetProtein}g).`;
  } else {
    sentence2 = `נותרו עוד כ-${proteinDiff}g חלבון להגעה ליעד היומי (${targetProtein}g) - שקול מנת חלבון איכותית להשלמת המכסה.`;
  }

  // 3. Tanita & Activity sentence:
  let sentence3 = '';
  const latestTanita = tanitaHistory && tanitaHistory.length > 0 ? tanitaHistory[0] : null;
  const visceral = latestTanita?.visceralFat;
  const steps = todayWorkout?.steps || 0;

  if (visceral && Number(visceral) >= 8) {
    sentence3 = `רמת השומן הויסצראלי הנוכחית היא ${visceral}; שילוב צעדים יומיים (${steps > 0 ? `${steps} צעדים היום` : 'יעד 8,000 צעדים'}) יאיץ את ירידתו.`;
  } else if (todayWorkout?.workedOut) {
    sentence3 = `אימון הכוח שביצעת היום מספק גירוי מבורך – הקפד על שתיית מים מרובה ומנוחה איכותית לבניית שריר מיטבית.`;
  } else {
    sentence3 = `להמשך שיפור מדדי הטניטה, הקפד על תנועה מתונה לאורך היום והתמדה ביעדי המאקרו האישיים.`;
  }

  return `${sentence1} ${sentence2} ${sentence3}`;
}

export async function fetchAiCoachingFeedback() {
  const user = state.activeUser;
  const profile = state.getCurrentProfile();
  const dateStr = state.selectedDate;
  
  const todayMeals = getMealsForDate(user, dateStr);
  const macroTotals = calculateDailyMacros(todayMeals);
  const tanitaHistory = getTanitaHistory(user);
  const todayWorkout = getWorkoutForDate(user, dateStr);
  const workoutBurn = calculateWorkoutBurn(todayWorkout);
  const netCalories = macroTotals.kcal - workoutBurn;

  const targetProtein = Number(profile?.targetProtein) || (user === 'Arik' ? 120 : 90);
  const consumedProtein = Number(macroTotals.protein) || 0;
  const targetKcal = Number(profile?.targetKcal) || (user === 'Arik' ? 1550 : 1250);
  const consumedKcal = Number(macroTotals.kcal) || 0;

  // Strict Mathematical calculations
  const isProteinMet = consumedProtein >= targetProtein;
  const calorieDiff = Number((targetKcal - consumedKcal).toFixed(1));
  const isCalorieUnderOrOnTarget = consumedKcal <= targetKcal;
  const isDangerouslyLowKcal = consumedKcal < 800;
  const isModerateSafeDeficit = calorieDiff >= 100 && calorieDiff <= 250 && isProteinMet;

  const contextData = {
    user,
    profile,
    todayMeals,
    macroTotals,
    tanitaHistory,
    todayWorkout,
    workoutBurn,
    netCalories,
    targetProtein,
    consumedProtein,
    targetKcal,
    consumedKcal,
    calorieDiff,
    isProteinMet,
    isCalorieUnderOrOnTarget,
    isDangerouslyLowKcal,
    isModerateSafeDeficit
  };

  try {
    const response = await fetch('/api/coach', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contextData)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Server error generating coaching feedback.');
    }

    const data = await response.json();
    let feedback = data.feedback;

    if (feedback) {
      // Strict Coach Verification:
      // If (protein_consumed >= protein_target), the coach MUST praise reaching the goal and NEVER say "עלייך להגיע ליעד החלבון".
      if (isProteinMet) {
        const negativeProteinRegex = /(עלייך|עליך)\s+להגיע\s+ליעד\s+החלבון|לא\s+הגעת\s+ליעד\s+החלבון|חסר\s+חלבון|הגבר\s+את\s+צריכת\s+החלבון/gi;
        if (negativeProteinRegex.test(feedback)) {
          feedback = feedback.replace(negativeProteinRegex, `כל הכבוד, הגעת ליעד החלבון (${consumedProtein}g מתוך ${targetProtein}g)!`);
        }
        // If protein is met, prevent false alarms about muscle wasting
        const muscleWastingRegex = /(חשש|סכנה|סכנת|אזהרה|עלול\s+להוביל)\s+(ל|של\s+)?פירוק\s+שריר/gi;
        if (muscleWastingRegex.test(feedback)) {
          feedback = feedback.replace(muscleWastingRegex, 'מסת השריר שלך מוגנת היטב');
        }
      }
      return feedback;
    }

    return evaluateCoachingFeedback(contextData);
  } catch (err) {
    console.warn('AI Coach connection note:', err.message || err);
    return evaluateCoachingFeedback(contextData);
  }
}
