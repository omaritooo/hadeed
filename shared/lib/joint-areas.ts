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

// Areas of this exercise that the user has flagged, in canonical order.
export const conflictingAreas = (stressors: readonly JointArea[], limitations: readonly JointArea[]): JointArea[] =>
  JOINT_AREAS.filter(area => stressors.includes(area) && limitations.includes(area))
