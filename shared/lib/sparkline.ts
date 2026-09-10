// Shared sparkline geometry math -- pure function, no Vue/DOM dependency, so it can be
// used from a computed() in any component. Originally lived only in app/pages/index.vue's
// weightSparkline computed; extracted here once the Stats page (strength-trend and
// body-metric-trend sections) needed the exact same math a second and third time.
export interface SparklineGeometry {
  width: number
  height: number
  linePoints: string
  averageY: number
}

// Returns null for fewer than 2 points -- a single point (or none) can't draw a line,
// and callers should render an empty-state instead. Mirrors the `trend.length < 2` guard
// that already existed on Home's weightSparkline computed.
export const buildSparkline = (values: number[], width = 100, height = 32): SparklineGeometry | null => {
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const padding = (max - min || 1) * 0.15
  const paddedMin = min - padding
  const paddedRange = max + padding - paddedMin || 1

  const toX = (index: number) => (index / (values.length - 1)) * width
  const toY = (value: number) => height - ((value - paddedMin) / paddedRange) * height

  const linePoints = values
    .map((value, index) => `${toX(index)},${toY(value)}`)
    .join(' ')
  const average = values.reduce((sum, value) => sum + value, 0) / values.length

  return { width, height, linePoints, averageY: toY(average) }
}
