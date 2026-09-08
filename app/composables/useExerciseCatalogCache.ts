import type { Exercise } from "~~/shared/types/exercise.types";

// Shared across the split builder (day/picker instances, and surviving navigation between the builder's
// steps) so the confirm step's recovery-conflict check can look up tier/primaryMuscles without an extra
// round-trip. Keyed by exercise id, populated as exercises are picked.
export const useExerciseCatalogCache = () => useState<Map<string, Exercise>>("exercise-catalog-cache", () => new Map());
