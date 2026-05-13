import {
  CHORD_PREVIEW_MIN_LENGTH,
  createPreviewLine,
  hasInvalidLineConflict,
  isPreviewValid,
} from './chordPreview'
import { GEOMETRY_EPSILON, getDistance, isPointOnLineSegment } from './geometry'
import { isLegalLineSegment } from './lineSegments'
import {
  getAreaPolygonPoints,
  getSplitMoveResult,
  isPointInsidePolygon,
  type SnappedPoint,
} from './useGameState'
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

const polygonCentroid = (points: Point[]): Point | null => {
  if (points.length === 0) {
    return null
  }

  const sum = points.reduce(
    (total, point) => ({
      x: total.x + point.x,
      y: total.y + point.y,
    }),
    { x: 0, y: 0 },
  )

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  }
}

/** Same geometric checks as preview, without requiring minimum resulting fragment size. */
const chordAllowsSplitGeometry = (
  start: SnappedPoint,
  p2: Point,
  endLineId: string,
  lines: Line[],
  areas: Area[],
): boolean => {
  if (start.lineId === endLineId) {
    return false
  }

  if (getDistance(start.point, p2) < CHORD_PREVIEW_MIN_LENGTH) {
    return false
  }

  const endSnapped: SnappedPoint = { point: p2, lineId: endLineId }
  const previewLine = createPreviewLine(start, endSnapped)

  if (hasInvalidLineConflict(previewLine, start, endSnapped, lines)) {
    return false
  }

  return getSplitMoveResult(areas, lines, previewLine) !== null
}

/**
 * Area of the child fragment that contains the parent region's centroid (stable label
 * as the free endpoint slides along an edge).
 */
const getAnchoredSideArea = (
  areaToSplit: Area,
  start: SnappedPoint,
  p2: Point,
  endLineId: string,
  lines: Line[],
  areas: Area[],
): number | null => {
  const tryPoint = (point: Point) => {
    if (!chordAllowsSplitGeometry(start, point, endLineId, lines, areas)) {
      return null
    }

    const endSnapped: SnappedPoint = { point, lineId: endLineId }
    const previewLine = createPreviewLine(start, endSnapped)
    const result = getSplitMoveResult(areas, lines, previewLine)

    if (!result) {
      return null
    }

    const parentCentroid = polygonCentroid(getAreaPolygonPoints(areaToSplit, lines))

    if (!parentCentroid) {
      return null
    }

    const linesWithChord = [...lines, previewLine]

    for (const fragment of result.splitResult.areas) {
      const fragmentPoly = getAreaPolygonPoints(fragment, linesWithChord)

      if (fragmentPoly.length >= 3 && isPointInsidePolygon(parentCentroid, fragmentPoly)) {
        return fragment.geometricArea
      }
    }

    return result.splitResult.areas[0].geometricArea
  }

  const direct = tryPoint(p2)

  if (direct !== null) {
    return direct
  }

  return null
}

const getAnchoredSideAreaAtSegmentEndpoint = (
  areaToSplit: Area,
  start: SnappedPoint,
  segment: LegalLineSegment,
  which: 'start' | 'end',
  endLineId: string,
  lines: Line[],
  areas: Area[],
): number | null => {
  const corner = which === 'start' ? segment.start : segment.end
  const other = which === 'start' ? segment.end : segment.start
  const dx = other.x - corner.x
  const dy = other.y - corner.y
  const len = Math.hypot(dx, dy)

  const atCorner = getAnchoredSideArea(areaToSplit, start, corner, endLineId, lines, areas)

  if (atCorner !== null) {
    return atCorner
  }

  if (len <= GEOMETRY_EPSILON) {
    return null
  }

  const inset = Math.min(1e-4, len * 1e-6)
  const nudge = { x: corner.x + (dx / len) * inset, y: corner.y + (dy / len) * inset }

  return getAnchoredSideArea(areaToSplit, start, nudge, endLineId, lines, areas)
}

/**
 * Locks the first endpoint and slides only the second along its legal boundary segment
 * so the anchored side (same side of the chord as the parent's centroid) has area =
 * half of the region being split.
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

  const { areaToSplit } = moveResult
  const totalArea = areaToSplit.geometricArea
  const targetArea = totalArea / 2

  const A0 = getAnchoredSideAreaAtSegmentEndpoint(areaToSplit, start, L2, 'start', end.lineId, lines, areas)
  const A1 = getAnchoredSideAreaAtSegmentEndpoint(areaToSplit, start, L2, 'end', end.lineId, lines, areas)

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
  const boundTol = GEOMETRY_EPSILON * areaScale + 1e-10

  if (targetArea < low - boundTol || targetArea > high + boundTol) {
    return null
  }

  const t = (targetArea - A0) / denom

  if (t < -1e-8 || t > 1 + 1e-8) {
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
