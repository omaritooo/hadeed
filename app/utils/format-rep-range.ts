export const formatRepRange = (min: number | null, max: number | null): string => {
  if (min === null && max === null) return "–"
  if (min === null || max === null || min === max) return String(min ?? max)
  return `${min}–${max}`
}
