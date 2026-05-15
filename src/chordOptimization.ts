import { GEOMETRY_EPSILON, getDistance } from './geometry'
import { buildLegalLineSegments, getClosestPointOnSegment, isLegalLineSegment } from './lineSegments'
import type { Area, LegalLineSegment, Line, Point } from './types'
import type { SnappedPoint } from './useGameState'
import { getSplitMoveResult, isSplitMoveAllowed } from './useGameState'

const PREVIEW_LINE_ID = 'chord-opt-preview'

const makePreviewLine = (start: SnappedPoint, end: SnappedPoint): Line => ({
  id: PREVIEW_LINE_ID,
  x1: start.point.x,
  y1: start.point.y,
  x2: end.point.x,
  y2: end.point.y,
  color: 'neutral',
  choice: 0,
})

const CHORD_MIN_LENGTH = 0.1
const SCAN_STEPS = 120

const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

const evaluateChordOnSegment = (
  start: SnappedPoint,
  probe: Point,
  segment: LegalLineSegment,
  lines: Line[],
  areas: Area[],
) => {
  const endPoint = getClosestPointOnSegment(probe, segment)
  const end: SnappedPoint = { point: endPoint, lineId: segment.lineId }

  if (getDistance(start.point, end.point) < CHORD_MIN_LENGTH + GEOMETRY_EPSILON) {
    return null
  }

  const previewLine = makePreviewLine(start, end)
  const split = getSplitMoveResult(areas, lines, previewLine)

  if (!split || !isSplitMoveAllowed(split)) {
    return null
  }

  return { end, split }
}

const iterChordSegments = (start: SnappedPoint, lines: Line[], areas: Area[]) =>
  buildLegalLineSegments(lines, areas).filter(
    (segment) => isLegalLineSegment(segment) && segment.lineId !== start.lineId,
  )

export const optimizeEvenSplitEndpoints = (
  start: SnappedPoint,
  currentEnd: SnappedPoint,
  lines: Line[],
  areas: Area[],
): SnappedPoint | null => {
  let bestEnd: SnappedPoint | null = null
  let bestScore = Number.POSITIVE_INFINITY
  let bestDist = Number.POSITIVE_INFINITY

  for (const segment of iterChordSegments(start, lines, areas)) {
    for (let step = 0; step <= SCAN_STEPS; step += 1) {
      const t = step / SCAN_STEPS
      const probe = lerpPoint(segment.start, segment.end, t)
      const evaluated = evaluateChordOnSegment(start, probe, segment, lines, areas)

      if (!evaluated) {
        continue
      }

      const [a0, a1] = evaluated.split.splitResult.areas
      const score = Math.abs(a0.geometricArea - a1.geometricArea)
      const dist = getDistance(currentEnd.point, evaluated.end.point)

      if (
        score < bestScore - 1e-9 ||
        (Math.abs(score - bestScore) <= 1e-9 && dist < bestDist - GEOMETRY_EPSILON)
      ) {
        bestScore = score
        bestDist = dist
        bestEnd = evaluated.end
      }
    }
  }

  return bestEnd
}

const SPLIT_TARGET = 5
const SPLIT_FIVE_TOLERANCE = 0.04

const matchesSplitFive = (a: number, b: number) =>
  Math.abs(a - SPLIT_TARGET) <= SPLIT_FIVE_TOLERANCE ||
  Math.abs(b - SPLIT_TARGET) <= SPLIT_FIVE_TOLERANCE

export const optimizeSplitFiveEndpoints = (
  start: SnappedPoint,
  currentEnd: SnappedPoint,
  lines: Line[],
  areas: Area[],
): SnappedPoint | null => {
  let bestEnd: SnappedPoint | null = null
  let bestDist = Number.POSITIVE_INFINITY

  for (const segment of iterChordSegments(start, lines, areas)) {
    for (let step = 0; step <= SCAN_STEPS; step += 1) {
      const t = step / SCAN_STEPS
      const probe = lerpPoint(segment.start, segment.end, t)
      const evaluated = evaluateChordOnSegment(start, probe, segment, lines, areas)

      if (!evaluated) {
        continue
      }

      const [a0, a1] = evaluated.split.splitResult.areas

      if (!matchesSplitFive(a0.geometricArea, a1.geometricArea)) {
        continue
      }

      const dist = getDistance(currentEnd.point, evaluated.end.point)

      if (dist < bestDist - GEOMETRY_EPSILON) {
        bestDist = dist
        bestEnd = evaluated.end
      }
    }
  }

  return bestEnd
}
