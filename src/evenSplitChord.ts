import {
  canPreviewMove,
  CHORD_PREVIEW_MIN_LENGTH,
  createPreviewLine,
  isPreviewValid,
} from './chordPreview'
import { GEOMETRY_EPSILON, getDistance, isPointOnLineSegment } from './geometry'
import { isLegalLineSegment } from './lineSegments'
import { getSplitMoveResult, isSplitMoveAllowed, type SnappedPoint } from './useGameState'
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

const pointOnSegment = (segment: LegalLineSegment, t: number): Point => ({
  x: segment.start.x + t * (segment.end.x - segment.start.x),
  y: segment.start.y + t * (segment.end.y - segment.start.y),
})

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const projectPointToSegmentParameter = (segment: LegalLineSegment, point: Point) => {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared <= GEOMETRY_EPSILON) {
    return 0
  }

  return clamp01(((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared)
}

const GRID_STEPS = 37

const evaluateSplitImbalance = (
  start: SnappedPoint,
  end: SnappedPoint,
  lines: Line[],
  areas: Area[],
): number | null => {
  if (!isPreviewValid(start, end, lines, areas)) {
    return null
  }

  const previewLine = createPreviewLine(start, end)
  const splitMoveResult = getSplitMoveResult(areas, lines, previewLine)

  if (!splitMoveResult || !isSplitMoveAllowed(splitMoveResult)) {
    return null
  }

  const [areaA, areaB] = splitMoveResult.splitResult.areas

  return Math.abs(areaA.geometricArea - areaB.geometricArea)
}

/**
 * Slide each endpoint along its original legal segment (same line ids) to
 * minimize |areaA − areaB| for the resulting split.
 */
export const optimizeEvenSplitEndpoints = (
  start: SnappedPoint,
  end: SnappedPoint,
  lines: Line[],
  areas: Area[],
  legalSegments: LegalLineSegment[],
): { start: SnappedPoint; end: SnappedPoint } | null => {
  const segStart = findLegalSegmentContainingPoint(legalSegments, start)
  const segEnd = findLegalSegmentContainingPoint(legalSegments, end)

  if (!segStart || !segEnd) {
    return null
  }

  const t0 = projectPointToSegmentParameter(segStart, start.point)
  const u0 = projectPointToSegmentParameter(segEnd, end.point)

  let bestT = t0
  let bestU = u0
  const initialImbalance = evaluateSplitImbalance(
    { point: pointOnSegment(segStart, t0), lineId: start.lineId },
    { point: pointOnSegment(segEnd, u0), lineId: end.lineId },
    lines,
    areas,
  )

  if (initialImbalance === null) {
    return null
  }

  let bestImbalance = initialImbalance

  const tryCandidate = (t: number, u: number) => {
    const candidateStart: SnappedPoint = {
      point: pointOnSegment(segStart, t),
      lineId: start.lineId,
    }
    const candidateEnd: SnappedPoint = {
      point: pointOnSegment(segEnd, u),
      lineId: end.lineId,
    }

    if (!canPreviewMove(candidateStart, candidateEnd, lines, areas)) {
      return
    }

    const diff = evaluateSplitImbalance(candidateStart, candidateEnd, lines, areas)

    if (diff !== null && diff < bestImbalance) {
      bestImbalance = diff
      bestT = t
      bestU = u
    }
  }

  const tDenom = Math.max(GRID_STEPS - 1, 1)

  for (let i = 0; i < GRID_STEPS; i += 1) {
    const t = i / tDenom

    for (let j = 0; j < GRID_STEPS; j += 1) {
      const u = j / tDenom
      tryCandidate(t, u)
    }
  }

  const window = 2 / tDenom
  const REFINE_STEPS = 13

  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < REFINE_STEPS; i += 1) {
      for (let j = 0; j < REFINE_STEPS; j += 1) {
        const offsetT = ((i / (REFINE_STEPS - 1)) * 2 - 1) * (window / 2)
        const offsetU = ((j / (REFINE_STEPS - 1)) * 2 - 1) * (window / 2)
        tryCandidate(clamp01(bestT + offsetT), clamp01(bestU + offsetU))
      }
    }
  }

  const optimizedStart: SnappedPoint = {
    point: pointOnSegment(segStart, bestT),
    lineId: start.lineId,
  }
  const optimizedEnd: SnappedPoint = {
    point: pointOnSegment(segEnd, bestU),
    lineId: end.lineId,
  }

  if (getDistance(optimizedStart.point, optimizedEnd.point) < CHORD_PREVIEW_MIN_LENGTH) {
    return null
  }

  if (!isPreviewValid(optimizedStart, optimizedEnd, lines, areas)) {
    return null
  }

  return { start: optimizedStart, end: optimizedEnd }
}
