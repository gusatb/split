import { GEOMETRY_EPSILON, getClosestPointOnLine, getDistance, isPointOnLineSegment } from './geometry'
import { getAreaPolygonPoints, isPointInsidePolygon } from './useGameState'
import type { Area, LegalLineSegment, Line, Point } from './types'

const SIDE_SAMPLE_DISTANCE = 0.01

const createLineFromPoints = (id: string, start: Point, end: Point): Line => ({
  id,
  x1: start.x,
  y1: start.y,
  x2: end.x,
  y2: end.y,
  color: 'neutral',
  choice: 0,
})

const getLineParameter = (line: Line, point: Point) => {
  const deltaX = line.x2 - line.x1
  const deltaY = line.y2 - line.y1
  const lengthSquared = deltaX ** 2 + deltaY ** 2

  if (lengthSquared <= GEOMETRY_EPSILON) {
    return 0
  }

  return ((point.x - line.x1) * deltaX + (point.y - line.y1) * deltaY) / lengthSquared
}

const addUniquePoint = (points: Point[], point: Point) => {
  if (points.some((existingPoint) => getDistance(existingPoint, point) <= GEOMETRY_EPSILON)) {
    return
  }

  points.push(point)
}

const isInsideScoredArea = (point: Point, scoredAreaPolygons: Point[][]) =>
  scoredAreaPolygons.some((polygon) => isPointInsidePolygon(point, polygon))

const getSegmentScoredSides = (
  segment: Line,
  scoredAreaPolygons: Point[][],
): Pick<LegalLineSegment, 'leftAreaScored' | 'rightAreaScored'> => {
  const deltaX = segment.x2 - segment.x1
  const deltaY = segment.y2 - segment.y1
  const length = Math.hypot(deltaX, deltaY)

  if (length <= GEOMETRY_EPSILON) {
    return {
      leftAreaScored: false,
      rightAreaScored: false,
    }
  }

  const midpoint = {
    x: (segment.x1 + segment.x2) / 2,
    y: (segment.y1 + segment.y2) / 2,
  }
  const leftPoint = {
    x: midpoint.x - (deltaY / length) * SIDE_SAMPLE_DISTANCE,
    y: midpoint.y + (deltaX / length) * SIDE_SAMPLE_DISTANCE,
  }
  const rightPoint = {
    x: midpoint.x + (deltaY / length) * SIDE_SAMPLE_DISTANCE,
    y: midpoint.y - (deltaX / length) * SIDE_SAMPLE_DISTANCE,
  }

  return {
    leftAreaScored: isInsideScoredArea(leftPoint, scoredAreaPolygons),
    rightAreaScored: isInsideScoredArea(rightPoint, scoredAreaPolygons),
  }
}

export const buildLegalLineSegments = (lines: Line[], areas: Area[]): LegalLineSegment[] => {
  const lineEndpoints = lines.flatMap((line) => [
    { x: line.x1, y: line.y1 },
    { x: line.x2, y: line.y2 },
  ])
  const scoredAreaPolygons = areas
    .filter((area) => area.color !== 'neutral')
    .map((area) => getAreaPolygonPoints(area, lines))

  return lines.flatMap((line) => {
    const pointsOnLine: Point[] = []

    lineEndpoints.forEach((point) => {
      if (isPointOnLineSegment(point, line)) {
        addUniquePoint(pointsOnLine, point)
      }
    })

    return pointsOnLine
      .sort((pointA, pointB) => getLineParameter(line, pointA) - getLineParameter(line, pointB))
      .flatMap((point, index) => {
        const nextPoint = pointsOnLine[index + 1]

        if (!nextPoint || getDistance(point, nextPoint) <= GEOMETRY_EPSILON) {
          return []
        }

        const segmentLine = createLineFromPoints(`${line.id}-segment-${index}`, point, nextPoint)
        const scoredSides = getSegmentScoredSides(segmentLine, scoredAreaPolygons)

        return [
          {
            ...scoredSides,
            id: segmentLine.id,
            lineId: line.id,
            start: point,
            end: nextPoint,
          },
        ]
      })
  })
}

export const isLegalLineSegment = (segment: LegalLineSegment) =>
  !(segment.leftAreaScored && segment.rightAreaScored)

export const getClosestPointOnSegment = (point: Point, segment: LegalLineSegment) =>
  getClosestPointOnLine(
    point,
    createLineFromPoints(segment.id, segment.start, segment.end),
  )
