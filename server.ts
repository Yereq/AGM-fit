import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

function generateFallbackCoaching(data: any): string {
  const { user, profile, macroTotals, workoutBurn, netCalories, tanitaHistory, todayWorkout } = data;
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
    sentence3 = `רמת השומן הויסצראלי הנוכחית היא ${visceral}; שמירה על צעדים יומיים (${steps > 0 ? `${steps} צעדים היום` : 'יעד 8,000 צעדים'}) תאיץ את ירידתו.`;
  } else if (todayWorkout?.workedOut) {
    sentence3 = `אימון הכוח שביצעת היום מספק גירוי מבורך – הקפד על שתיית מים מרובה ומנוחה איכותית לבניית שריר מיטבית.`;
  } else {
    sentence3 = `להמשך שיפור מדדי הטניטה, הקפד על תנועה מתונה לאורך היום והתמדה ביעדי המאקרו האישיים.`;
  }

  return `${sentence1} ${sentence2} ${sentence3}`;
}

async function generateCoachResponseWithFallback(ai: GoogleGenAI, prompt: string, fallbackData: any): Promise<string> {
  // Try fast and resilient models in order: gemini-3.1-flash-lite is highly available and fast, gemini-3.8-flash, gemini-flash-latest
  const models = ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"];

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: "You are a professional clinical nutritionist and fitness coach specializing in body recomposition, visceral fat reduction, and muscle preservation. Respond strictly in 3 precise sentences in Hebrew.",
          }
        });

        if (response.text && response.text.trim()) {
          return response.text.trim();
        }
      } catch (err: any) {
        // Silently retry or switch model on temporary demand spikes (503/429) without flooding error logs
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 600));
        }
      }
    }
  }

  // Gracefully fallback to the built-in clinical coaching algorithm if remote models are unavailable
  return generateFallbackCoaching(fallbackData);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API endpoint for AI Coach
  app.post("/api/coach", async (req, res) => {
    try {
      const { user, profile, stats, todayMeals, macroTotals, tanitaHistory, todayWorkout, workoutBurn, netCalories } = req.body;
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        // Provide intelligent coaching fallback if API key is not yet set
        const fallback = generateFallbackCoaching({ user, profile, macroTotals, workoutBurn, netCalories, tanitaHistory, todayWorkout });
        return res.json({ feedback: fallback });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const workoutSummary = todayWorkout && (todayWorkout.workedOut || todayWorkout.steps > 0 || workoutBurn > 0)
        ? `Workout / Activity Today:
- Trained today: ${todayWorkout.workedOut ? 'YES' : 'Rest day'}
- Steps: ${todayWorkout.steps || 0} (~${((todayWorkout.steps || 0) * 0.00075).toFixed(2)} km)
- Active Burned Calories: ${workoutBurn || 0} kcal (smartwatch/activity)
- Strength Session: ${todayWorkout.strengthDuration ? `${todayWorkout.strengthDuration} min on ${todayWorkout.strengthMuscles?.join(', ') || 'weights'}` : 'None'}
- Net Calories: ${netCalories || (macroTotals.kcal - (workoutBurn || 0))} kcal (Food ${macroTotals.kcal} - Burn ${workoutBurn || 0})
- Notes: ${todayWorkout.notes || 'None'}`
        : `Workout / Activity Today: No workout or activity logged yet for today.`;

      const targetProteinVal = Number(profile?.targetProtein) || (user === 'Arik' ? 120 : 90);
      const consumedProteinVal = Number(macroTotals?.protein) || 0;
      const targetKcalVal = Number(profile?.targetKcal) || (user === 'Arik' ? 1550 : 1250);
      const consumedKcalVal = Number(macroTotals?.kcal) || 0;
      const isProteinMet = consumedProteinVal >= targetProteinVal;
      const calorieDiff = Number((targetKcalVal - consumedKcalVal).toFixed(1));
      const isCalorieUnderOrOnTarget = consumedKcalVal <= targetKcalVal;
      const isDangerouslyLowKcal = consumedKcalVal < 800;

      const prompt = `You are an elite expert fitness, nutrition, and body composition coach. 
Analyze the following user profile, today's food macros, and workout/activity in Hebrew (שפה עברית). Provide sharp, professional, highly actionable 3-sentence feedback focusing strictly on visceral fat reduction and lean muscle retention (שמירה על מסת שריר והפחתת שומן ויסצראלי).

User Profile:
Name: ${user} (${profile?.hebrewName || (user === 'Arik' ? 'אריק' : 'גרניט')})
Details: Height ${profile?.height || 175}cm, Target Weight ${profile?.targetWeight || 75}kg
Daily Targets: ${targetKcalVal} kcal, Protein: ${targetProteinVal}g, Carbs: ${profile?.targetCarbs || 180}g, Fat: ${profile?.targetFat || 60}g

Today's Logged Meals & Macros:
Total Consumed: ${consumedKcalVal} kcal | Protein: ${consumedProteinVal}g | Carbs: ${macroTotals?.carbs || 0}g | Fat: ${macroTotals?.fat || 0}g

Mathematical Verification Flags:
- isProteinMet: ${isProteinMet} (Consumed: ${consumedProteinVal}g vs Target: ${targetProteinVal}g)
- calorieDiff: ${calorieDiff} kcal (Target: ${targetKcalVal} - Consumed: ${consumedKcalVal})
- isCalorieUnderOrOnTarget: ${isCalorieUnderOrOnTarget}
- isDangerouslyLowKcal: ${isDangerouslyLowKcal}

${workoutSummary}

Latest Tanita Body Composition:
${tanitaHistory && tanitaHistory.length > 0 ? JSON.stringify(tanitaHistory[0]) : 'No Tanita entry logged yet.'}

Strict Rules:
1. If protein consumed (${consumedProteinVal}g) >= target protein (${targetProteinVal}g), you MUST PRAISE the user for reaching or exceeding their protein goal (e.g. "כל הכבוד, הגעת ליעד החלבון (${consumedProteinVal}g מתוך ${targetProteinVal}g)!"). NEVER say "עלייך להגיע ליעד החלבון" or warn about missing protein!
2. If protein is MET and calories are within target or in moderate deficit (100-250 kcal below target), do NOT alarm the user with "muscle wasting" (פירוק שריר). Instead, confirm that it is a solid, safe deficit for targeted fat loss while muscle is fully preserved.
3. If Protein >= 100% and Calories <= 100% (and not < 800 kcal), evaluate: "יום חיטוב מצוין ומדויק. שמרת על חלבון גבוה שיגן על השריר תוך גירעון קלורי קל לשריפת שומן."
4. Only warn about low calories if consumption is dangerously low (< 800 kcal) or if protein was missed.
5. Give exactly 3 distinct, sharp, highly professional sentences of coaching advice in Hebrew.`;

      let feedback = await generateCoachResponseWithFallback(ai, prompt, {
        user,
        profile,
        macroTotals,
        workoutBurn,
        netCalories,
        tanitaHistory,
        todayWorkout
      });

      if (isProteinMet && feedback) {
        const negativeProteinRegex = /(עלייך|עליך)\s+להגיע\s+ליעד\s+החלבון|לא\s+הגעת\s+ליעד\s+החלבון|חסר\s+חלבון|הגבר\s+את\s+צריכת\s+החלבון/gi;
        if (negativeProteinRegex.test(feedback)) {
          feedback = feedback.replace(negativeProteinRegex, `כל הכבוד, הגעת ליעד החלבון (${consumedProteinVal}g מתוך ${targetProteinVal}g)!`);
        }
        const muscleWastingRegex = /(חשש|סכנה|סכנת|אזהרה|עלול\s+להוביל)\s+(ל|של\s+)?פירוק\s+שריר/gi;
        if (muscleWastingRegex.test(feedback)) {
          feedback = feedback.replace(muscleWastingRegex, 'מסת השריר מוגנת היטב');
        }
      }

      res.json({ feedback });
    } catch (error: any) {
      console.error("AI Coach Error:", error);
      // Even in worst case error, return structured fallback coaching instead of 500 error
      const fallback = generateFallbackCoaching(req.body || {});
      res.json({ feedback: fallback });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
