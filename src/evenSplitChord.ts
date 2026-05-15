import {
  CHORD_PREVIEW_MIN_LENGTH,
  createPreviewLine,
  isPreviewValid,
} from './chordPreview'
import { GEOMETRY_EPSILON, getDistance, isPointOnLineSegment } from './geometry'
import { getClosestPointOnSegment, isLegalLineSegment } from './lineSegments'
import { getSplitMoveResult, type SnappedPoint } from './useGameState'
import type { Area, LegalLineSegment, Line, Point } from './types'

const segmentAsLine = (segment: LegalLineSegment): Line => ({
  id: segment.id,
  x1: segment.start.x,
  y1: segment.start.y,
  x2: segment.end.x,
  y2: segment.end.y,
  color: 'neutral',
  choice: 0,
})

const findLegalSegmentContainingPoint = (
  segments: LegalLineSegment[],
  snapped: SnappedPoint,
): LegalLineSegment | null => {
  const candidates = segments.filter(
    (segment) => segment.lineId === snapped.lineId && isLegalLineSegment(segment),
  )

  for (const segment of candidates) {
    if (isPointOnLineSegment(snapped.point, segmentAsLine(segment))) {
      return segment
    }
  }

  return null
}

/**
 * Prefer the segment that actually contains the snapped point; if float noise
 * breaks `isPointOnLineSegment`, fall back to the closest legal segment on that line.
 */
const resolveSegmentForEnd = (
  segments: LegalLineSegment[],
  snapped: SnappedPoint,
): LegalLineSegment | null => {
  const contained = findLegalSegmentContainingPoint(segments, snapped)

  if (contained) {
    return contained
  }

  const candidates = segments.filter(
    (segment) => segment.lineId === snapped.lineId && isLegalLineSegment(segment),
  )

  let best: LegalLineSegment | null = null
  let bestDistance = Infinity

  for (const segment of candidates) {
    const closest = getClosestPointOnSegment(snapped.point, segment)
    const distance = getDistance(snapped.point, closest)

    if (distance < bestDistance) {
      bestDistance = distance
      best = segment
    }
  }

  const maxFallbackDistance = 0.35

  if (best && bestDistance <= maxFallbackDistance) {
    return best
  }

  return null
}

const pointOnSegmentT = (segment: LegalLineSegment, t: number): Point => ({
  x: segment.start.x + t * (segment.end.x - segment.start.x),
  y: segment.start.y + t * (segment.end.y - segment.start.y),
})

const projectPointToSegmentT = (segment: LegalLineSegment, point: Point): number => {
  const deltaX = segment.end.x - segment.start.x
  const deltaY = segment.end.y - segment.start.y
  const lengthSquared = deltaX ** 2 + deltaY ** 2

  if (lengthSquared <= GEOMETRY_EPSILON) {
    return 0
  }

  const projection =
    ((point.x - segment.start.x) * deltaX + (point.y - segment.start.y) * deltaY) / lengthSquared

  return Math.min(1, Math.max(0, projection))
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Locks the first endpoint and slides only the second along its legal boundary segment
 * to minimize |areaA − areaB| for the region being split (closest achievable 50/50 on
 * that edge). Uses dense sampling plus local refinement so it does not depend on how
 * split fragments are ordered in engine output.
 */
export const optimizeEvenSplitEndpoints = (
  start: SnappedPoint,
  end: SnappedPoint,
  lines: Line[],
  areas: Area[],
  legalSegments: LegalLineSegment[],
): { start: SnappedPoint; end: SnappedPoint } | null => {
  const L2 = resolveSegmentForEnd(legalSegments, end)

  if (!L2) {
    return null
  }

  const baseline = createPreviewLine(start, end)

  if (getSplitMoveResult(areas, lines, baseline) === null) {
    return null
  }

  const tSeed = projectPointToSegmentT(L2, end.point)
  const coarseSteps = 81
  const denom = Math.max(coarseSteps - 1, 1)

  let bestT: number | null = null
  let bestImbalance = Infinity

  const consider = (t: number) => {
    const tUse = clamp01(t)
    const p2 = pointOnSegmentT(L2, tUse)

    if (getDistance(start.point, p2) < CHORD_PREVIEW_MIN_LENGTH) {
      return
    }

    const newEnd: SnappedPoint = { point: p2, lineId: end.lineId }

    if (!isPreviewValid(start, newEnd, lines, areas)) {
      return
    }

    const previewLine = createPreviewLine(start, newEnd)
    const result = getSplitMoveResult(areas, lines, previewLine)

    if (!result) {
      return
    }

    const [fragmentA, fragmentB] = result.splitResult.areas
    const imbalance = Math.abs(fragmentA.geometricArea - fragmentB.geometricArea)

    if (bestT === null) {
      bestImbalance = imbalance
      bestT = tUse

      return
    }

    if (imbalance < bestImbalance - 1e-9) {
      bestImbalance = imbalance
      bestT = tUse

      return
    }

    if (Math.abs(imbalance - bestImbalance) <= 1e-9 && Math.abs(tUse - tSeed) < Math.abs(bestT - tSeed)) {
      bestImbalance = imbalance
      bestT = tUse
    }
  }

  for (let index = 0; index < coarseSteps; index++) {
    consider(index / denom)
  }

  consider(tSeed)

  let radius = 1 / denom

  for (let pass = 0; pass < 6; pass++) {
    if (bestT === null) {
      break
    }

    for (let k = -12; k <= 12; k++) {
      consider(bestT + (k / 12) * radius)
    }

    radius *= 0.4
  }

  if (bestT === null) {
    return null
  }

  const p2Final = pointOnSegmentT(L2, bestT)
  const finalEnd: SnappedPoint = { point: p2Final, lineId: end.lineId }

  if (getDistance(start.point, p2Final) < CHORD_PREVIEW_MIN_LENGTH) {
    return null
  }

  if (!isPreviewValid(start, finalEnd, lines, areas)) {
    return null
  }

  return { start, end: finalEnd }
}
