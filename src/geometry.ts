import type { Line, Point } from './types'

export const GEOMETRY_EPSILON = 1e-6

const toLinePoints = (line: Line): [Point, Point] => [
  { x: line.x1, y: line.y1 },
  { x: line.x2, y: line.y2 },
]

export const arePointsEqual = (
  pointA: Point,
  pointB: Point,
  epsilon = GEOMETRY_EPSILON,
) => getDistance(pointA, pointB) <= epsilon

export function getDistance(pointA: Point, pointB: Point) {
  return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y)
}

export function getClosestPointOnLine(point: Point, line: Line): Point {
  const [lineStart, lineEnd] = toLinePoints(line)
  const lineDeltaX = lineEnd.x - lineStart.x
  const lineDeltaY = lineEnd.y - lineStart.y
  const lengthSquared = lineDeltaX ** 2 + lineDeltaY ** 2

  if (lengthSquared <= GEOMETRY_EPSILON) {
    return lineStart
  }

  const projection =
    ((point.x - lineStart.x) * lineDeltaX + (point.y - lineStart.y) * lineDeltaY) /
    lengthSquared
  const clampedProjection = Math.max(0, Math.min(1, projection))

  return {
    x: lineStart.x + clampedProjection * lineDeltaX,
    y: lineStart.y + clampedProjection * lineDeltaY,
  }
}

const getOrientation = (pointA: Point, pointB: Point, pointC: Point) => {
  const value =
    (pointB.y - pointA.y) * (pointC.x - pointB.x) -
    (pointB.x - pointA.x) * (pointC.y - pointB.y)

  if (Math.abs(value) <= GEOMETRY_EPSILON) {
    return 0
  }

  return value > 0 ? 1 : 2
}

export function isPointOnLineSegment(point: Point, line: Line) {
  const [lineStart, lineEnd] = toLinePoints(line)
  const crossProduct =
    (point.y - lineStart.y) * (lineEnd.x - lineStart.x) -
    (point.x - lineStart.x) * (lineEnd.y - lineStart.y)

  if (Math.abs(crossProduct) > GEOMETRY_EPSILON) {
    return false
  }

  return (
    point.x <= Math.max(lineStart.x, lineEnd.x) + GEOMETRY_EPSILON &&
    point.x >= Math.min(lineStart.x, lineEnd.x) - GEOMETRY_EPSILON &&
    point.y <= Math.max(lineStart.y, lineEnd.y) + GEOMETRY_EPSILON &&
    point.y >= Math.min(lineStart.y, lineEnd.y) - GEOMETRY_EPSILON
  )
}

export function doLinesIntersect(lineA: Line, lineB: Line) {
  const [lineAStart, lineAEnd] = toLinePoints(lineA)
  const [lineBStart, lineBEnd] = toLinePoints(lineB)

  const orientation1 = getOrientation(lineAStart, lineAEnd, lineBStart)
  const orientation2 = getOrientation(lineAStart, lineAEnd, lineBEnd)
  const orientation3 = getOrientation(lineBStart, lineBEnd, lineAStart)
  const orientation4 = getOrientation(lineBStart, lineBEnd, lineAEnd)

  if (orientation1 !== orientation2 && orientation3 !== orientation4) {
    return true
  }

  if (orientation1 === 0 && isPointOnLineSegment(lineBStart, lineA)) {
    return true
  }

  if (orientation2 === 0 && isPointOnLineSegment(lineBEnd, lineA)) {
    return true
  }

  if (orientation3 === 0 && isPointOnLineSegment(lineAStart, lineB)) {
    return true
  }

  return orientation4 === 0 && isPointOnLineSegment(lineAEnd, lineB)
}

export function calculatePolygonArea(points: Point[]) {
  const shoelaceSum = points.reduce((sum, point, index) => {
    const nextPoint = points[(index + 1) % points.length]

    return sum + point.x * nextPoint.y - nextPoint.x * point.y
  }, 0)

  return Math.abs(shoelaceSum) / 2
}

export function isPointOnIntersection(point: Point, existingLines: Line[]) {
  return existingLines.some(
    (line) =>
      arePointsEqual(point, { x: line.x1, y: line.y1 }) ||
      arePointsEqual(point, { x: line.x2, y: line.y2 }),
  )
}
