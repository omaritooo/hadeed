import type { BodyState } from "body-muscles"

// This app's exercises only carry coarse muscle-group names (see gym_exercises.json / the
// `muscles` table) -- body-muscles models ~70 finer anatomical regions. Each group name below
// fans out to every region it should light up.
const MUSCLE_GROUP_IDS: Record<string, string[]> = {
  chest: ["chest-upper-left", "chest-upper-right", "chest-lower-left", "chest-lower-right"],
  shoulders: [
    "shoulder-front-left", "shoulder-front-right",
    "shoulder-side-left", "shoulder-side-right",
    "deltoid-rear-left", "deltoid-rear-right",
  ],
  biceps: ["biceps-left", "biceps-right"],
  triceps: ["triceps-long-left", "triceps-lateral-left", "triceps-long-right", "triceps-lateral-right"],
  forearms: [
    "forearm-left", "forearm-right",
    "forearm-flexors-left", "forearm-extensors-left",
    "forearm-flexors-right", "forearm-extensors-right",
  ],
  abdominals: [
    "abs-upper-left", "abs-upper-right", "abs-lower-left", "abs-lower-right",
    "obliques-left", "obliques-right",
  ],
  quadriceps: ["quads-left", "quads-right"],
  hamstrings: [
    "hamstrings-medial-left", "hamstrings-lateral-left",
    "hamstrings-medial-right", "hamstrings-lateral-right",
  ],
  calves: [
    "calves-gastroc-medial-left", "calves-gastroc-lateral-left", "calves-soleus-left",
    "calves-gastroc-medial-right", "calves-gastroc-lateral-right", "calves-soleus-right",
  ],
  glutes: ["gluteus-medius-left", "gluteus-maximus-left", "gluteus-medius-right", "gluteus-maximus-right"],
  lats: ["lats-upper-left", "lats-mid-left", "lats-lower-left", "lats-upper-right", "lats-mid-right", "lats-lower-right"],
  // body-muscles has no separate rhomboid/mid-back region -- traps-mid and the upper lats sit in
  // roughly that spot, so "middle back" borrows those rather than going unmapped.
  "middle back": ["traps-mid-left", "traps-mid-right", "lats-upper-left", "lats-upper-right"],
  "lower back": [
    "lower-back-erectors-left", "lower-back-ql-left",
    "lower-back-erectors-right", "lower-back-ql-right",
  ],
  traps: [
    "traps-upper-left", "traps-mid-left", "traps-lower-left",
    "traps-upper-right", "traps-mid-right", "traps-lower-right",
  ],
  neck: ["neck-left", "neck-right", "nape"],
  adductors: ["adductors-left", "adductors-right"],
  tibialis: ["tibialis-anterior-left", "tibialis-anterior-right"],
  // "abductors" has no distinct region in body-muscles (gluteus-medius, the real abductor, is
  // already claimed by "glutes" above) -- left unmapped rather than double-assigned.
}

const PRIMARY_INTENSITY = 9
const SECONDARY_INTENSITY = 4

export function buildMuscleBodyState(primaryMuscles: string[], secondaryMuscles: string[]): BodyState {
  const state: BodyState = {}

  for (const muscle of secondaryMuscles) {
    for (const id of MUSCLE_GROUP_IDS[muscle] ?? []) {
      state[id] = { intensity: SECONDARY_INTENSITY, selected: false }
    }
  }
  // Applied after secondary so a muscle listed as both (shouldn't happen, but the API allows it)
  // renders at primary intensity.
  for (const muscle of primaryMuscles) {
    for (const id of MUSCLE_GROUP_IDS[muscle] ?? []) {
      state[id] = { intensity: PRIMARY_INTENSITY, selected: false }
    }
  }

  return state
}
