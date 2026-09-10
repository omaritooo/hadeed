// Standard plate sets a commercial gym is likely to rack, largest first. Kept as the two most
// common conventions rather than something user-configurable — see Task 18 of the app-wide UX
// plan: a sensible hardcoded default with an inline bar-weight override is enough for v1.
export const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const
export const LB_PLATES = [45, 35, 25, 10, 5, 2.5] as const

export const DEFAULT_BAR_WEIGHT_KG = 20
export const DEFAULT_BAR_WEIGHT_LB = 45

export type PlateUnitSystem = 'metric' | 'imperial'

export const plateSetForUnitSystem = (unitSystem: PlateUnitSystem): readonly number[] => {
  return unitSystem === 'imperial' ? LB_PLATES : KG_PLATES
}

export const defaultBarWeightForUnitSystem = (unitSystem: PlateUnitSystem): number => {
  return unitSystem === 'imperial' ? DEFAULT_BAR_WEIGHT_LB : DEFAULT_BAR_WEIGHT_KG
}

export interface PlateCalculation {
  /** Plates to load on one side of the bar, largest first. Empty when the bar alone covers the target. */
  platesPerSide: number[]
  /** The actual total (bar + both sides' plates) this loadout produces — may fall short of targetTotal. */
  achievedTotal: number
  /** targetTotal - achievedTotal. Zero when the target is exactly reachable with the given plate set. */
  remainder: number
}

// A plate's weight (e.g. 1.25) times 1000 stays comfortably clear of float noise (1.25 * 1000
// === 1250 exactly), so doing the greedy allocation in these integer "milli-units" instead of
// raw floats avoids remaining-weight comparisons silently failing on things like
// 0.1 + 0.2 !== 0.3.
const toMilliUnits = (weight: number): number => Math.round(weight * 1000)

// Greedily allocates the largest plates first to fill one side of the bar, the standard way
// lifters and plate-loading calculators work: for a target total weight and a given bar weight,
// figure out how much needs to sit on each side, then take the biggest available plate that
// still fits, repeatedly, until nothing bigger fits or the side is exactly filled. Weights that
// can't be hit exactly with the given plate set (e.g. an odd number with only 2.5kg-and-up
// plates) land on the closest achievable total at or below the target, with the shortfall
// reported as `remainder` rather than thrown away.
export const calculatePlatesPerSide = (input: {
  targetTotal: number
  barWeight: number
  plateSet?: readonly number[]
}): PlateCalculation => {
  const availablePlates = [...(input.plateSet ?? KG_PLATES)].sort((a, b) => b - a)

  const targetUnits = toMilliUnits(input.targetTotal)
  const barUnits = toMilliUnits(input.barWeight)
  const perSideTargetUnits = Math.max(0, Math.round((targetUnits - barUnits) / 2))

  let remainingUnits = perSideTargetUnits
  const platesPerSide: number[] = []
  for (const plate of availablePlates) {
    const plateUnits = toMilliUnits(plate)
    if (plateUnits <= 0) continue
    while (remainingUnits >= plateUnits) {
      platesPerSide.push(plate)
      remainingUnits -= plateUnits
    }
  }

  const achievedPerSideUnits = perSideTargetUnits - remainingUnits
  const achievedTotalUnits = barUnits + achievedPerSideUnits * 2
  const achievedTotal = achievedTotalUnits / 1000
  const remainder = (targetUnits - achievedTotalUnits) / 1000

  return { platesPerSide, achievedTotal, remainder }
}
