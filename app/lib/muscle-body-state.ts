import type { BodyState } from "body-muscles"

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
}

const PRIMARY_INTENSITY = 9
const SECONDARY_INTENSITY = 4

export const buildMuscleBodyState = (primaryMuscles: string[], secondaryMuscles: string[]): BodyState => {
  const state: BodyState = {}

  for (const muscle of secondaryMuscles) {
    for (const id of MUSCLE_GROUP_IDS[muscle] ?? []) {
      state[id] = { intensity: SECONDARY_INTENSITY, selected: false }
    }
  }
  for (const muscle of primaryMuscles) {
    for (const id of MUSCLE_GROUP_IDS[muscle] ?? []) {
      state[id] = { intensity: PRIMARY_INTENSITY, selected: false }
    }
  }

  return state
}
