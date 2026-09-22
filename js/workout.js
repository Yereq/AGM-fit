import { STORAGE_KEYS } from './config.js';
import { getStoredItem, setStoredItem } from './storage.js';

export const MUSCLE_GROUPS = [
  { id: 'chest', label: 'חזה' },
  { id: 'back', label: 'גב' },
  { id: 'legs', label: 'רגליים וישבן' },
  { id: 'arms', label: 'זרועות וכתפיים' },
  { id: 'core', label: 'בטן וליבה' },
  { id: 'fullbody', label: 'גוף מלא (Full Body)' }
];

export function getDefaultWorkout() {
  return {
    workedOut: false,
    steps: 0,
    smartwatchCalories: 0,
    strengthDuration: 0,
    strengthMuscles: [],
    notes: '',
    updatedAt: null
  };
}

export function getWorkoutForDate(user, dateStr) {
  const key = `${STORAGE_KEYS.WORKOUT_PREFIX}${user}_${dateStr}`;
  const data = getStoredItem(key, null);
  if (!data) {
    return getDefaultWorkout();
  }
  return {
    workedOut: Boolean(data.workedOut),
    steps: Number(data.steps) || 0,
    smartwatchCalories: Number(data.smartwatchCalories) || 0,
    strengthDuration: Number(data.strengthDuration) || 0,
    strengthMuscles: Array.isArray(data.strengthMuscles) ? data.strengthMuscles : [],
    notes: data.notes || '',
    updatedAt: data.updatedAt || null
  };
}

export function saveWorkoutForDate(user, dateStr, workoutData) {
  const key = `${STORAGE_KEYS.WORKOUT_PREFIX}${user}_${dateStr}`;
  const record = {
    workedOut: Boolean(workoutData.workedOut),
    steps: Math.max(0, parseInt(workoutData.steps, 10) || 0),
    smartwatchCalories: Math.max(0, parseInt(workoutData.smartwatchCalories, 10) || 0),
    strengthDuration: Math.max(0, parseInt(workoutData.strengthDuration, 10) || 0),
    strengthMuscles: Array.isArray(workoutData.strengthMuscles) ? workoutData.strengthMuscles : [],
    notes: (workoutData.notes || '').trim(),
    updatedAt: new Date().toISOString()
  };
  setStoredItem(key, record);
  return record;
}

export function hasWorkoutForDate(user, dateStr) {
  const w = getWorkoutForDate(user, dateStr);
  return Boolean(w && (w.workedOut || w.steps > 0 || w.smartwatchCalories > 0 || w.strengthDuration > 0));
}

export function estimateStepsDistanceKm(steps) {
  const s = Math.max(0, Number(steps) || 0);
  return Number((s * 0.00075).toFixed(2));
}

export function estimateStepsCalories(steps) {
  const s = Math.max(0, Number(steps) || 0);
  return Math.round(s * 0.04);
}

export function calculateWorkoutBurn(workout) {
  if (!workout) return 0;
  if (workout.smartwatchCalories && workout.smartwatchCalories > 0) {
    return workout.smartwatchCalories;
  }
  // Otherwise sum step burn + strength burn (~6 kcal/min)
  const stepsBurn = estimateStepsCalories(workout.steps || 0);
  const strengthBurn = Math.round((Number(workout.strengthDuration) || 0) * 6);
  return stepsBurn + strengthBurn;
}

export function calculateNetCalories(foodCaloriesConsumed, workoutCaloriesBurned) {
  const food = Math.max(0, Number(foodCaloriesConsumed) || 0);
  const burn = Math.max(0, Number(workoutCaloriesBurned) || 0);
  return food - burn;
}
