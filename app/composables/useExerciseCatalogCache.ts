import type { Exercise } from "~~/shared/types/exercise.types";

// Module-level singleton: exercises picked anywhere in the split builder (across day/picker instances,
// and surviving navigation between the builder's steps) are cached here by id, so the confirm step's
// recovery-conflict check can look up tier/primaryMuscle without an extra round-trip.
const cache = new Map<string, Exercise>();

export const useExerciseCatalogCache = () => cache;
