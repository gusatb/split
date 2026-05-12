import {
  canPreviewMove,
  CHORD_PREVIEW_MIN_LENGTH,
  createPreviewLine,
  isPreviewValid,
} from './chordPreview'
import { GEOMETRY_EPSILON, getDistance, isPointOnLineSegment } from './geometry'
import { isLegalLineSegment } from './lineSegments'
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
 * Area of the first polygon returned by the game's split geometry for chord pA–pB
 * (same ordering as {@link getSplitMoveResult} / `splitResult.areas[0]`).
 */
const getSplitArea = (
  pA: Point,
  lineIdA: string,
  pB: Point,
  lineIdB: string,
  lines: Line[],
  areas: Area[],
): number | null => {
  const snappedA: SnappedPoint = { point: pA, lineId: lineIdA }
  const snappedB: SnappedPoint = { point: pB, lineId: lineIdB }

  if (!canPreviewMove(snappedA, snappedB, lines, areas)) {
    return null
  }

  const previewLine = createPreviewLine(snappedA, snappedB)
  const result = getSplitMoveResult(areas, lines, previewLine)

  if (!result) {
    return null
  }

  return result.splitResult.areas[0].geometricArea
}

/**
 * Locks the first endpoint and slides only the second along its legal boundary segment
 * so the first split fragment has area = half of the region being split (analytical).
 */
export const optimizeEvenSplitEndpoints = (
  start: SnappedPoint,
  end: SnappedPoint,
  lines: Line[],
  areas: Area[],
  legalSegments: LegalLineSegment[],
): { start: SnappedPoint; end: SnappedPoint } | null => {
  const L2 = findLegalSegmentContainingPoint(legalSegments, end)

  if (!L2) {
    return null
  }

  const baseline = createPreviewLine(start, end)
  const moveResult = getSplitMoveResult(areas, lines, baseline)

  if (!moveResult) {
    return null
  }

  const totalArea = moveResult.areaToSplit.geometricArea
  const targetArea = totalArea / 2

  const A0 = getSplitArea(start.point, start.lineId, L2.start, end.lineId, lines, areas)
  const A1 = getSplitArea(start.point, start.lineId, L2.end, end.lineId, lines, areas)

  if (A0 === null || A1 === null) {
    return null
  }

  const denom = A1 - A0
  const areaScale = Math.max(totalArea, 1)

  if (Math.abs(denom) <= GEOMETRY_EPSILON * areaScale) {
    return null
  }

  const low = Math.min(A0, A1)
  const high = Math.max(A0, A1)
  const boundTol = GEOMETRY_EPSILON * areaScale + 1e-12

  if (targetArea < low - boundTol || targetArea > high + boundTol) {
    return null
  }

  const t = (targetArea - A0) / denom

  if (t < -1e-9 || t > 1 + 1e-9) {
    return null
  }

  const tUse = Math.min(1, Math.max(0, t))

  const p2New: Point = {
    x: L2.start.x + tUse * (L2.end.x - L2.start.x),
    y: L2.start.y + tUse * (L2.end.y - L2.start.y),
  }

  const newEnd: SnappedPoint = { point: p2New, lineId: end.lineId }

  if (getDistance(start.point, p2New) < CHORD_PREVIEW_MIN_LENGTH) {
    return null
  }

  if (!isPreviewValid(start, newEnd, lines, areas)) {
    return null
  }

  return { start, end: newEnd }
}
