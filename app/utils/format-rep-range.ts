// Rep prescription label. Either end can be missing (`undefined` from an older cached payload is
// treated like null), and an inverted range is shown the right way round.
export const formatRepRange = (min: number | null | undefined, max: number | null | undefined): string => {
  if (min == null && max == null) return "–"
  if (max == null) return `${min}+`
  if (min == null) return `up to ${max}`
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  return low === high ? String(low) : `${low}–${high}`
}
