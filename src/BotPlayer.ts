import {
  doLinesIntersect,
  GEOMETRY_EPSILON,
  getDistance,
  isPointOnLineSegment,
} from './geometry'
import {
  FILL_CAPTURE_LIMIT,
  getAreaPolygonPoints,
  getSplitMoveResult,
  isSplitMoveAllowed,
  type GameState,
  type SplitResult,
} from './useGameState'
import type { Area, Line, PlayerColor, Point } from './types'

const DEFAULT_NODE_COUNT = 5
const WINNING_SCORE = 50
const MIN_LINE_LENGTH = 0.1
const NON_SCORE_COEFFICIENT = 0.5

const botScoreFromGeometricArea = (geometricArea: number) => Math.sqrt(geometricArea)

const isFillCaptureSizeArea = (area: Area) => area.geometricArea <= FILL_CAPTURE_LIMIT

const pickSmallerAndLargerArea = (
  areaA: Area,
  areaB: Area,
): { smaller: Area; larger: Area } =>
  areaA.geometricArea <= areaB.geometricArea
    ? { smaller: areaA, larger: areaB }
    : { smaller: areaB, larger: areaA }

interface BoundarySegment {
  id: string
  index: number
  lineId: string
  start: Point
  end: Point
}

export interface CandidateNode {
  point: Point
  lineId: string
  segmentIndex: number
}

export interface FillCandidateMove {
  kind: 'fill'
  area: Area
}

export interface SplitCandidateMove {
  kind: 'split'
  area: Area
  line: Line
  start: CandidateNode
  end: CandidateNode
  splitResult: SplitResult
  isScoringMove: boolean
}

export type CandidateMove = FillCandidateMove | SplitCandidateMove

export interface EvaluatedCandidateMove {
  move: CandidateMove
  score: number
  isWinningMove: boolean
}

export interface DefenseChoice {
  chosenForOpponent: Area
  remainingArea: Area
}

const getOpponentColor = (playerColor: PlayerColor): PlayerColor =>
  playerColor === 'player1' ? 'player2' : 'player1'

const createLineFromPoints = (
  id: string,
  start: Point,
  end: Point,
  color: PlayerColor,
): Line => ({
  id,
  x1: start.x,
  y1: start.y,
  x2: end.x,
  y2: end.y,
  color,
  choice: 0,
})

const findLineById = (lines: Line[], lineId: string) =>
  lines.find((line) => line.id === lineId)

const getLineContainingSegment = (lines: Line[], start: Point, end: Point) =>
  lines.find((line) => isPointOnLineSegment(start, line) && isPointOnLineSegment(end, line))

const getAreaBoundarySegments = (area: Area, lines: Line[]): BoundarySegment[] => {
  const polygon = getAreaPolygonPoints(area, lines)

  return polygon.flatMap((point, index) => {
    const nextPoint = polygon[(index + 1) % polygon.length]
    const containingLine = getLineContainingSegment(lines, point, nextPoint)

    if (!containingLine || getDistance(point, nextPoint) <= GEOMETRY_EPSILON) {
      return []
    }

    return [
      {
        id: `${area.id}-boundary-${index}`,
        index,
        lineId: containingLine.id,
        start: point,
        end: nextPoint,
      },
    ]
  })
}

const getBoundaryNodes = (segment: BoundarySegment, nodeCount: number): CandidateNode[] =>
  Array.from({ length: nodeCount }, (_, nodeIndex) => {
    const ratio = (nodeIndex + 1) / (nodeCount + 1)

    return {
      point: {
        x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
        y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
      },
      lineId: segment.lineId,
      segmentIndex: segment.index,
    }
  })

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

const canIgnoreEndpointIntersection = (line: Line, candidateLine: Line) => {
  const candidateStart = { x: candidateLine.x1, y: candidateLine.y1 }
  const candidateEnd = { x: candidateLine.x2, y: candidateLine.y2 }

  return isPointOnLineSegment(candidateStart, line) || isPointOnLineSegment(candidateEnd, line)
}

const candidateLineCrossesExistingLines = (
  candidateLine: Line,
  lines: Line[],
  endpointLineIds: Set<string>,
) =>
  lines.some((line) => {
    if (endpointLineIds.has(line.id)) {
      return doLinesOverlap(line, candidateLine)
    }

    if (doLinesOverlap(line, candidateLine)) {
      return true
    }

    return doLinesIntersect(line, candidateLine) && !canIgnoreEndpointIntersection(line, candidateLine)
  })

const getAreaPair = (splitResult: SplitResult): [Area, Area] => [
  splitResult.areas[0],
  splitResult.areas[1],
]

export const getNonScore = (area: Area, playerColor: PlayerColor, lines: Line[] = []) => {
  const boundarySegments = getAreaBoundarySegments(area, lines)
  let myLines = 0
  let allLines = 0

  for (const segment of boundarySegments) {
    const line = findLineById(lines, segment.lineId)
    if (!line) {
      continue
    }

    allLines += 1
    if (line.color === playerColor) {
      myLines += 1
    }
  }

  const boundaryControlRatio = allLines > 0 ? myLines / allLines : 0

  return (
    NON_SCORE_COEFFICIENT *
    botScoreFromGeometricArea(area.geometricArea) *
    boundaryControlRatio
  )
}

export const getNowScore = (area: Area, playerColor: PlayerColor, lines: Line[] = []) =>
  area.geometricArea <= FILL_CAPTURE_LIMIT
    ? botScoreFromGeometricArea(area.geometricArea)
    : getNonScore(area, playerColor, lines)

export const chooseAreaForOpponent = (
  areaA: Area,
  areaB: Area,
  scoringPlayer: PlayerColor,
  lines: Line[],
): DefenseChoice => {
  const maxArea = Math.max(areaA.geometricArea, areaB.geometricArea)
  const sizeDiff =
    maxArea <= GEOMETRY_EPSILON
      ? 0
      : Math.abs(areaA.geometricArea - areaB.geometricArea) / maxArea

  const chosenForOpponent =
    sizeDiff <= 0.05
      ? getNonScore(areaA, scoringPlayer, lines) <= getNonScore(areaB, scoringPlayer, lines)
        ? areaA
        : areaB
      : areaA.geometricArea <= areaB.geometricArea
        ? areaA
        : areaB

  return {
    chosenForOpponent,
    remainingArea: chosenForOpponent.id === areaA.id ? areaB : areaA,
  }
}

export const generateCandidateMoves = (
  gameState: GameState,
  botColor: PlayerColor,
  nodeCount = DEFAULT_NODE_COUNT,
): CandidateMove[] =>
  gameState.areas
    .filter((area) => area.color === 'neutral')
    .flatMap((area) => {
      const candidates: CandidateMove[] = []

      if (area.geometricArea <= FILL_CAPTURE_LIMIT) {
        candidates.push({
          kind: 'fill',
          area,
        })
        return candidates
      }

      const nodes = getAreaBoundarySegments(area, gameState.lines).flatMap((segment) =>
        getBoundaryNodes(segment, nodeCount),
      )

      for (let startIndex = 0; startIndex < nodes.length; startIndex += 1) {
        for (let endIndex = startIndex + 1; endIndex < nodes.length; endIndex += 1) {
          const start = nodes[startIndex]
          const end = nodes[endIndex]

          if (start.segmentIndex === end.segmentIndex) {
            continue
          }

          if (getDistance(start.point, end.point) < MIN_LINE_LENGTH) {
            continue
          }

          const line = createLineFromPoints(
            `bot-${area.id}-${startIndex}-${endIndex}`,
            start.point,
            end.point,
            botColor,
          )
          const endpointLineIds = new Set([start.lineId, end.lineId])

          if (candidateLineCrossesExistingLines(line, gameState.lines, endpointLineIds)) {
            continue
          }

          const splitMoveResult = getSplitMoveResult(gameState.areas, gameState.lines, line)

          if (!splitMoveResult || splitMoveResult.areaToSplit.id !== area.id) {
            continue
          }

          if (!isSplitMoveAllowed(splitMoveResult)) {
            continue
          }

          candidates.push({
            kind: 'split',
            area,
            line,
            start,
            end,
            splitResult: splitMoveResult.splitResult,
            isScoringMove:
              findLineById(gameState.lines, start.lineId)?.color === botColor &&
              findLineById(gameState.lines, end.lineId)?.color === botColor,
          })
        }
      }

      return candidates
    })

export const evaluateCandidateMove = (
  move: CandidateMove,
  gameState: GameState,
  botColor: PlayerColor,
): EvaluatedCandidateMove => {
  if (move.kind === 'fill') {
    const score = botScoreFromGeometricArea(move.area.geometricArea)
    const gamePointsFromMove = move.area.geometricArea

    return {
      move,
      score,
      isWinningMove: gameState.playerScores[botColor] + gamePointsFromMove > WINNING_SCORE,
    }
  }

  const [areaA, areaB] = getAreaPair(move.splitResult)
  const linesAfterMove = [...gameState.lines, move.line]

  let score: number
  let gamePointsFromMove = 0

  if (move.isScoringMove) {
    interface ScoringScenario {
      score: number
      rawBotPoints: number
    }

    const scenarios: ScoringScenario[] = []

    const defenseChoice = chooseAreaForOpponent(areaA, areaB, botColor, linesAfterMove)
    scenarios.push({
      score:
        botScoreFromGeometricArea(defenseChoice.chosenForOpponent.geometricArea) +
        getNonScore(defenseChoice.remainingArea, botColor, linesAfterMove),
      rawBotPoints: defenseChoice.chosenForOpponent.geometricArea,
    })

    if (isFillCaptureSizeArea(areaA)) {
      scenarios.push({
        score:
          botScoreFromGeometricArea(areaB.geometricArea) -
          botScoreFromGeometricArea(areaA.geometricArea),
        rawBotPoints: areaB.geometricArea,
      })
    }

    if (isFillCaptureSizeArea(areaB)) {
      scenarios.push({
        score:
          botScoreFromGeometricArea(areaA.geometricArea) -
          botScoreFromGeometricArea(areaB.geometricArea),
        rawBotPoints: areaA.geometricArea,
      })
    }

    if (isFillCaptureSizeArea(areaA) && isFillCaptureSizeArea(areaB)) {
      const { smaller, larger } = pickSmallerAndLargerArea(areaA, areaB)
      scenarios.push({
        score:
          botScoreFromGeometricArea(smaller.geometricArea) -
          botScoreFromGeometricArea(larger.geometricArea),
        rawBotPoints: smaller.geometricArea,
      })
    }

    score = Math.min(...scenarios.map((s) => s.score))
    gamePointsFromMove = Math.min(
      ...scenarios.filter((s) => s.score === score).map((s) => s.rawBotPoints),
    )
  } else {
    const aSmall = isFillCaptureSizeArea(areaA)
    const bSmall = isFillCaptureSizeArea(areaB)

    if (aSmall && bSmall) {
      const { smaller, larger } = pickSmallerAndLargerArea(areaA, areaB)
      score =
        botScoreFromGeometricArea(smaller.geometricArea) -
        botScoreFromGeometricArea(larger.geometricArea)
    } else if (aSmall) {
      score =
        getNonScore(areaB, botColor, linesAfterMove) -
        botScoreFromGeometricArea(areaA.geometricArea)
    } else if (bSmall) {
      score =
        getNonScore(areaA, botColor, linesAfterMove) -
        botScoreFromGeometricArea(areaB.geometricArea)
    } else {
      score =
        getNonScore(areaA, botColor, linesAfterMove) + getNonScore(areaB, botColor, linesAfterMove)
    }
  }

  return {
    move,
    score,
    isWinningMove: gameState.playerScores[botColor] + gamePointsFromMove > WINNING_SCORE,
  }
}

export const getBestBotMove = (
  gameState: GameState,
  botColor: PlayerColor,
  nodeCount = DEFAULT_NODE_COUNT,
) => {
  const candidates = generateCandidateMoves(gameState, botColor, nodeCount)
  let bestMove: EvaluatedCandidateMove | null = null

  for (const candidate of candidates) {
    const evaluatedMove = evaluateCandidateMove(candidate, gameState, botColor)

    if (evaluatedMove.isWinningMove) {
      return evaluatedMove
    }

    if (!bestMove || evaluatedMove.score > bestMove.score) {
      bestMove = evaluatedMove
    }
  }

  return bestMove
}

export const getDefenseChoiceForPlayer = (
  areaA: Area,
  areaB: Area,
  opponentColor: PlayerColor,
  lines: Line[],
) => chooseAreaForOpponent(areaA, areaB, opponentColor, lines)

export const getBotOpponentColor = getOpponentColor
