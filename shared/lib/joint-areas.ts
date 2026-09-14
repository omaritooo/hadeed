export const JOINT_AREAS = ['knee', 'shoulder', 'lower_back', 'wrist', 'elbow', 'ankle'] as const
export type JointArea = typeof JOINT_AREAS[number]

export const JOINT_AREA_LABELS: Record<JointArea, string> = {
  knee: 'Knee',
  shoulder: 'Shoulder',
  lower_back: 'Lower back',
  wrist: 'Wrist',
  elbow: 'Elbow',
  ankle: 'Ankle',
}

export const isJointArea = (value: unknown): value is JointArea =>
  typeof value === 'string' && (JOINT_AREAS as readonly string[]).includes(value)

export const isJointAreaList = (value: unknown): value is JointArea[] =>
  Array.isArray(value) && value.every(isJointArea)

// Areas of this exercise that the user has flagged, in canonical order.
export const conflictingAreas = (stressors: readonly JointArea[], limitations: readonly JointArea[]): JointArea[] =>
  JOINT_AREAS.filter(area => stressors.includes(area) && limitations.includes(area))

const areaListFormat = new Intl.ListFormat('en', { type: 'conjunction' })

// "knee", "knee and shoulder", "knee, shoulder, and wrist": lower-cased labels, in the order given.
export const formatAreaList = (areas: readonly JointArea[]): string =>
  areaListFormat.format(areas.map(area => JOINT_AREA_LABELS[area].toLowerCase()))

// The preset recommendation reason for tier-1 exercises that load a limited joint. The matcher lives
// beside the wording because the client picks this reason out of the list to style it as a warning.
export const describeLimitationReason = (count: number, areas: readonly JointArea[]): string =>
  `${count} exercise${count === 1 ? ' loads' : 's load'} your ${formatAreaList(areas)}`

export const isLimitationReason = (reason: string): boolean => /^\d+ exercises? loads? your /.test(reason)

// The first candidate that stresses none of the flagged areas and isn't in `exclude` (e.g. exercises
// already in the same day), or undefined. `stressors` is optional because an Exercise cached from
// before stressors existed has no such field; it counts as clean.
export const firstCleanCandidate = <T extends { id: string, stressors?: readonly JointArea[] }>(
  candidates: readonly T[],
  limitations: readonly JointArea[],
  exclude: ReadonlySet<string> = new Set(),
): T | undefined =>
  candidates.find(candidate =>
    !exclude.has(candidate.id) && conflictingAreas(candidate.stressors ?? [], limitations).length === 0)
