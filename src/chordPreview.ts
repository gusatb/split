import {
  doLinesIntersect,
  GEOMETRY_EPSILON,
  getDistance,
  isPointOnLineSegment,
} from './geometry'
import { getSplitMoveResult, isSplitMoveAllowed, type SnappedPoint } from './useGameState'
import type { Area, Line } from './types'

export const CHORD_PREVIEW_MIN_LENGTH = 0.1

export const createPreviewLine = (start: SnappedPoint, end: SnappedPoint): Line => ({
  id: 'preview-line',
  x1: start.point.x,
  y1: start.point.y,
  x2: end.point.x,
  y2: end.point.y,
  color: 'neutral',
  choice: 0,
})

const canLineIntersectionBeIgnored = (line: Line, previewLine: Line) => {
  const previewStart = { x: previewLine.x1, y: previewLine.y1 }
  const previewEnd = { x: previewLine.x2, y: previewLine.y2 }

  return (
    isPointOnLineSegment(previewStart, line) || isPointOnLineSegment(previewEnd, line)
  )
}

const doLinesOverlap = (lineA: Line, lineB: Line) => {
  const overlappingPoints = [
    { x: lineA.x1, y: lineA.y1 },
    { x: lineA.x2, y: lineA.y2 },
    { x: lineB.x1, y: lineB.y1 },
    { x: lineB.x2, y: lineB.y2 },
  ].filter((point) => isPointOnLineSegment(point, lineA) && isPointOnLineSegment(point, lineB))

  return overlappingPoints.some((point, index) =>
    overlappingPoints
      .slice(index + 1)
      .some((otherPoint) => getDistance(point, otherPoint) > GEOMETRY_EPSILON),
  )
}

export const hasInvalidLineConflict = (
  previewLine: Line,
  start: SnappedPoint,
  end: SnappedPoint,
  lines: Line[],
) =>
  lines.some((line) => {
    if (line.id === start.lineId || line.id === end.lineId) {
      return doLinesOverlap(line, previewLine)
    }

    if (doLinesOverlap(line, previewLine)) {
      return true
    }

    return doLinesIntersect(line, previewLine) && !canLineIntersectionBeIgnored(line, previewLine)
  })

export const canPreviewMove = (
  start: SnappedPoint,
  end: SnappedPoint,
  lines: Line[],
  areas: Area[],
) => {
  if (start.lineId === end.lineId) {
    return false
  }

  if (getDistance(start.point, end.point) < CHORD_PREVIEW_MIN_LENGTH) {
    return false
  }

  const previewLine = createPreviewLine(start, end)

  if (hasInvalidLineConflict(previewLine, start, end, lines)) {
    return false
  }

  return getSplitMoveResult(areas, lines, previewLine) !== null
}

export const isPreviewValid = (
  start: SnappedPoint,
  end: SnappedPoint,
  lines: Line[],
  areas: Area[],
) => {
  if (!canPreviewMove(start, end, lines, areas)) {
    return false
  }

  const previewLine = createPreviewLine(start, end)
  const splitMoveResult = getSplitMoveResult(areas, lines, previewLine)

  return splitMoveResult !== null && isSplitMoveAllowed(splitMoveResult)
}
