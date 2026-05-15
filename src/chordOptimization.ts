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

const pickClosestAmongBest = <T extends { dist: number }>(tier: T[]): T => {
  let best = tier[0]

  for (const candidate of tier.slice(1)) {
    if (candidate.dist < best.dist - GEOMETRY_EPSILON) {
      best = candidate
    }
  }

  return best
}

/**
 * Best-effort even split: minimize |A − B|; when several placements tie on that score, pick the
 * end closest to `currentEnd` (the user's second endpoint).
 */
export const optimizeEvenSplitEndpoints = (
  start: SnappedPoint,
  currentEnd: SnappedPoint,
  lines: Line[],
  areas: Area[],
): SnappedPoint => {
  const candidates: { end: SnappedPoint; imbalance: number; dist: number }[] = []

  for (const segment of iterChordSegments(start, lines, areas)) {
    for (let step = 0; step <= SCAN_STEPS; step += 1) {
      const t = step / SCAN_STEPS
      const probe = lerpPoint(segment.start, segment.end, t)
      const evaluated = evaluateChordOnSegment(start, probe, segment, lines, areas)

      if (!evaluated) {
        continue
      }

      const [a0, a1] = evaluated.split.splitResult.areas
      const imbalance = Math.abs(a0.geometricArea - a1.geometricArea)
      const dist = getDistance(currentEnd.point, evaluated.end.point)
      candidates.push({ end: evaluated.end, imbalance, dist })
    }
  }

  if (candidates.length === 0) {
    return currentEnd
  }

  const minImbalance = Math.min(...candidates.map((c) => c.imbalance))
  const imbalanceEps = 1e-6
  const tier = candidates.filter((c) => c.imbalance <= minImbalance + imbalanceEps)

  return pickClosestAmongBest(tier).end
}

const SPLIT_TARGET = 5

/**
 * Best-effort “split 5”: minimize how far the smaller fragment is from 5.0; ties go to the end
 * closest to `currentEnd`.
 */
export const optimizeSplitFiveEndpoints = (
  start: SnappedPoint,
  currentEnd: SnappedPoint,
  lines: Line[],
  areas: Area[],
): SnappedPoint => {
  const candidates: { end: SnappedPoint; score: number; dist: number }[] = []

  for (const segment of iterChordSegments(start, lines, areas)) {
    for (let step = 0; step <= SCAN_STEPS; step += 1) {
      const t = step / SCAN_STEPS
      const probe = lerpPoint(segment.start, segment.end, t)
      const evaluated = evaluateChordOnSegment(start, probe, segment, lines, areas)

      if (!evaluated) {
        continue
      }

      const [a0, a1] = evaluated.split.splitResult.areas
      const score = Math.min(
        Math.abs(a0.geometricArea - SPLIT_TARGET),
        Math.abs(a1.geometricArea - SPLIT_TARGET),
      )
      const dist = getDistance(currentEnd.point, evaluated.end.point)
      candidates.push({ end: evaluated.end, score, dist })
    }
  }

  if (candidates.length === 0) {
    return currentEnd
  }

  const minScore = Math.min(...candidates.map((c) => c.score))
  const scoreEps = 1e-4
  const tier = candidates.filter((c) => c.score <= minScore + scoreEps)

  return pickClosestAmongBest(tier).end
}
