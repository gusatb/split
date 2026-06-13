import { useEffect, useMemo, useRef, useState } from 'react'
import {
  arePointsEqual,
  calculatePolygonArea,
  GEOMETRY_EPSILON,
  isPointOnLineSegment,
} from './geometry'
import {
  defaultGameId,
  localStorageAdapter,
  supabaseAdapter,
  type StorageAdapter,
} from './storage'
import type { Area, AreaColor, Line, PlayerColor, Point, PointReference } from './types'

const BOARD_UNITS = 10
const CANVAS_SIZE = 600
/** Neutral areas with geometric area **strictly below** this value may be captured via click-to-fill. */
export const FILL_CAPTURE_LIMIT = 5
/** Tiny nudge used when steering Split 5 fragments toward >= 5.0. */
export const FILL_CAPTURE_EPSILON = 1e-4

/**
 * An area is fillable when its area is strictly less than 5.0. The geometric
 * area is rounded first so float noise on a true 5.0 area (e.g. 4.9999999998)
 * is treated as exactly 5.0 and therefore NOT fillable.
 */
export const isFillCaptureSizeArea = (geometricArea: number) =>
  Math.round(geometricArea * 1e6) / 1e6 < FILL_CAPTURE_LIMIT
export const MIN_RESULTING_AREA = 1
const WINNING_SCORE = 50

const createInitialLines = (): Line[] => [
  {
    id: 'boundary-top',
    x1: 0,
    y1: 0,
    x2: BOARD_UNITS,
    y2: 0,
    color: 'neutral',
    choice: 0,
  },
  {
    id: 'boundary-right',
    x1: BOARD_UNITS,
    y1: 0,
    x2: BOARD_UNITS,
    y2: BOARD_UNITS,
    color: 'neutral',
    choice: 0,
  },
  {
    id: 'boundary-bottom',
    x1: BOARD_UNITS,
    y1: BOARD_UNITS,
    x2: 0,
    y2: BOARD_UNITS,
    color: 'neutral',
    choice: 0,
  },
  {
    id: 'boundary-left',
    x1: 0,
    y1: BOARD_UNITS,
    x2: 0,
    y2: 0,
    color: 'neutral',
    choice: 0,
  },
]

export interface BoardConfig {
  boardUnits: number
  canvasSize: number
  pixelsPerUnit: number
}

export interface GameState {
  board: BoardConfig
  lines: Line[]
  areas: Area[]
  currentPlayer: PlayerColor
  turnCount: number
  playerScores: Record<PlayerColor, number>
  winner: PlayerColor | null
  pendingAreaChoice: PendingAreaChoice | null
  onlinePlayers?: {
    host: PlayerColor
    joiner: PlayerColor
  }
}

export interface PendingAreaChoice {
  scoringPlayer: PlayerColor
  choosingPlayer: PlayerColor
  areaIds: [string, string]
}

export interface SnappedPoint {
  point: Point
  lineId: string
}

export interface SplitResult {
  areas: [Area, Area]
}

export interface SplitMoveResult {
  areaToSplit: Area
  splitResult: SplitResult
}

const getNextPlayer = (player: PlayerColor): PlayerColor =>
  player === 'player1' ? 'player2' : 'player1'

const swapColor = <TColor extends AreaColor>(color: TColor): TColor => {
  if (color === 'player1') {
    return 'player2' as TColor
  }

  if (color === 'player2') {
    return 'player1' as TColor
  }

  return color
}

const createInitialAreas = (): Area[] => [
  {
    id: 'area-root',
    color: 'neutral',
    points: [
      { lineId: 'boundary-top', endpoint: 1 },
      { lineId: 'boundary-top', endpoint: 2 },
      { lineId: 'boundary-right', endpoint: 2 },
      { lineId: 'boundary-bottom', endpoint: 2 },
    ],
    geometricArea: BOARD_UNITS * BOARD_UNITS,
  },
]

export const createInitialGameState = (): GameState => {
  const lines = createInitialLines()

  return {
    board: {
      boardUnits: BOARD_UNITS,
      canvasSize: CANVAS_SIZE,
      pixelsPerUnit: CANVAS_SIZE / BOARD_UNITS,
    },
    lines,
    areas: createInitialAreas(),
    currentPlayer: 'player1',
    turnCount: 0,
    playerScores: {
      player1: 0,
      player2: 0,
    },
    winner: null,
    pendingAreaChoice: null,
  }
}

export const getPointForReference = (
  reference: PointReference,
  lines: Line[],
): Point => {
  const line = lines.find((candidate) => candidate.id === reference.lineId)

  if (!line) {
    throw new Error(`Missing line for point reference: ${reference.lineId}`)
  }

  return reference.endpoint === 1
    ? { x: line.x1, y: line.y1 }
    : { x: line.x2, y: line.y2 }
}

export const getAreaPolygonPoints = (area: Area, lines: Line[]) =>
  area.points.map((reference) => getPointForReference(reference, lines))

export const isPointInsidePolygon = (point: Point, polygon: Point[]) => {
  let isInside = false

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previousIndex]
    const edgeLine: Line = {
      id: 'polygon-edge',
      x1: previousPoint.x,
      y1: previousPoint.y,
      x2: currentPoint.x,
      y2: currentPoint.y,
      color: 'neutral',
      choice: 0,
    }

    if (isPointOnLineSegment(point, edgeLine)) {
      return true
    }

    const crossesRay =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x

    if (crossesRay) {
      isInside = !isInside
    }
  }

  return isInside
}

const buildAreaVertices = (area: Area, lines: Line[]) =>
  area.points.map((reference) => ({
    point: getPointForReference(reference, lines),
    reference,
  }))

const createLineFromPoints = (id: string, startPoint: Point, endPoint: Point): Line => ({
  id,
  x1: startPoint.x,
  y1: startPoint.y,
  x2: endPoint.x,
  y2: endPoint.y,
  color: 'neutral',
  choice: 0,
})

const getDistanceAlongEdge = (edgeStart: Point, point: Point) =>
  Math.hypot(point.x - edgeStart.x, point.y - edgeStart.y)

const splitAreaByLine = (area: Area, lines: Line[], newLine: Line): SplitResult | null => {
  const startPoint = { x: newLine.x1, y: newLine.y1 }
  const endPoint = { x: newLine.x2, y: newLine.y2 }
  const startReference: PointReference = { lineId: newLine.id, endpoint: 1 }
  const endReference: PointReference = { lineId: newLine.id, endpoint: 2 }
  const vertices = buildAreaVertices(area, lines)
  const augmentedVertices: Array<{ point: Point; reference: PointReference }> = []
  let startInsertions = 0
  let endInsertions = 0

  vertices.forEach((vertex, index) => {
    const nextVertex = vertices[(index + 1) % vertices.length]
    const edgeLine = createLineFromPoints('area-edge', vertex.point, nextVertex.point)
    const insertedVertices: Array<{ point: Point; reference: PointReference }> = []

    augmentedVertices.push(vertex)

    if (
      isPointOnLineSegment(startPoint, edgeLine) &&
      !arePointsEqual(startPoint, vertex.point) &&
      !arePointsEqual(startPoint, nextVertex.point)
    ) {
      insertedVertices.push({ point: startPoint, reference: startReference })
      startInsertions += 1
    }

    if (
      isPointOnLineSegment(endPoint, edgeLine) &&
      !arePointsEqual(endPoint, vertex.point) &&
      !arePointsEqual(endPoint, nextVertex.point)
    ) {
      insertedVertices.push({ point: endPoint, reference: endReference })
      endInsertions += 1
    }

    insertedVertices
      .sort(
        (vertexA, vertexB) =>
          getDistanceAlongEdge(vertex.point, vertexA.point) -
          getDistanceAlongEdge(vertex.point, vertexB.point),
      )
      .forEach((insertedVertex) => augmentedVertices.push(insertedVertex))
  })

  if (startInsertions !== 1 || endInsertions !== 1) {
    return null
  }

  const startIndex = augmentedVertices.findIndex(
    (vertex) => vertex.reference.lineId === newLine.id && vertex.reference.endpoint === 1,
  )
  const endIndex = augmentedVertices.findIndex(
    (vertex) => vertex.reference.lineId === newLine.id && vertex.reference.endpoint === 2,
  )

  if (startIndex < 0 || endIndex < 0 || Math.abs(startIndex - endIndex) === 1) {
    return null
  }

  const getPath = (fromIndex: number, toIndex: number) => {
    const path: Array<{ point: Point; reference: PointReference }> = []
    let currentIndex = fromIndex

    while (true) {
      path.push(augmentedVertices[currentIndex])

      if (currentIndex === toIndex) {
        break
      }

      currentIndex = (currentIndex + 1) % augmentedVertices.length
    }

    return path
  }

  const firstPath = getPath(startIndex, endIndex)
  const secondPath = getPath(endIndex, startIndex)
  const firstAreaSize = calculatePolygonArea(firstPath.map((vertex) => vertex.point))
  const secondAreaSize = calculatePolygonArea(secondPath.map((vertex) => vertex.point))

  if (firstAreaSize <= GEOMETRY_EPSILON || secondAreaSize <= GEOMETRY_EPSILON) {
    return null
  }

  return {
    areas: [
      {
        id: `${area.id}-${newLine.id}-a`,
        color: 'neutral',
        points: firstPath.map((vertex) => vertex.reference),
        geometricArea: firstAreaSize,
      },
      {
        id: `${area.id}-${newLine.id}-b`,
        color: 'neutral',
        points: secondPath.map((vertex) => vertex.reference),
        geometricArea: secondAreaSize,
      },
    ],
  }
}

const findAreaToSplit = (areas: Area[], lines: Line[], newLine: Line) =>
  areas.find((area) => {
    if (area.color !== 'neutral') {
      return false
    }

    return splitAreaByLine(area, lines, newLine) !== null
  })

export const getSplitMoveResult = (
  areas: Area[],
  lines: Line[],
  newLine: Line,
): SplitMoveResult | null => {
  const areaToSplit = findAreaToSplit(areas, lines, newLine)

  if (!areaToSplit) {
    return null
  }

  const splitResult = splitAreaByLine(areaToSplit, lines, newLine)

  if (!splitResult) {
    return null
  }

  return {
    areaToSplit,
    splitResult,
  }
}

export const isSplitMoveAllowed = ({ areaToSplit, splitResult }: SplitMoveResult) =>
  !isFillCaptureSizeArea(areaToSplit.geometricArea) &&
  splitResult.areas.every((area) => area.geometricArea >= MIN_RESULTING_AREA)

const addScore = (
  playerScores: Record<PlayerColor, number>,
  player: PlayerColor,
  points: number,
) => {
  const nextScores = {
    ...playerScores,
    [player]: playerScores[player] + points,
  }

  return {
    playerScores: nextScores,
    winner: nextScores[player] > WINNING_SCORE ? player : null,
  }
}

const markAreaBoundaryFilled = (lines: Line[], areas: Area[]) => {
  const boundaryCounts = areas.reduce<Record<string, number>>((counts, capturedArea) => {
    capturedArea.points.forEach((point) => {
      counts[point.lineId] = (counts[point.lineId] ?? 0) + 1
    })

    return counts
  }, {})

  return lines.map((line) => {
    const boundaryCount = boundaryCounts[line.id] ?? 0

    if (boundaryCount === 0) {
      return line
    }

    const filledSides = line.filledSides ?? {
      left: line.choice === 2,
      right: line.choice === 1,
    }

    if (boundaryCount >= 2) {
      return {
        ...line,
        choice: 2 as const,
        filledSides: {
          left: true,
          right: true,
        },
      }
    }

    if (!filledSides.right) {
      return {
        ...line,
        choice: 1 as const,
        filledSides: {
          ...filledSides,
          right: true,
        },
      }
    }

    return {
      ...line,
      choice: 2 as const,
      filledSides: {
        ...filledSides,
        left: true,
      },
    }
  })
}

export interface UseGameStateOptions {
  gameId?: string
  initialState?: GameState | null
  storageAdapter?: StorageAdapter
}

export function useGameState(options: UseGameStateOptions = {}) {
  const gameId = options.gameId ?? defaultGameId
  const storageAdapter = useMemo<StorageAdapter>(
    () => options.storageAdapter ?? (options.gameId ? supabaseAdapter : localStorageAdapter),
    [options.gameId, options.storageAdapter],
  )
  const suppressNextSaveRef = useRef(false)
  const [gameState, setGameState] = useState<GameState>(
    () => options.initialState ?? createInitialGameState(),
  )

  useEffect(() => {
    if (options.initialState) {
      return
    }

    let isMounted = true

    Promise.resolve(storageAdapter.loadGameState(gameId))
      .then((storedState) => {
        if (isMounted && storedState) {
          suppressNextSaveRef.current = true
          setGameState(storedState)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load game state', error)
      })

    return () => {
      isMounted = false
    }
  }, [gameId, options.initialState, storageAdapter])

  useEffect(() => {
    if (!storageAdapter.subscribeToGameState) {
      return
    }

    let cleanup: (() => void) | undefined
    let isMounted = true

    Promise.resolve(
      storageAdapter.subscribeToGameState(gameId, (nextState: GameState) => {
        suppressNextSaveRef.current = true
        setGameState(nextState)
      }),
    )
      .then((unsubscribe) => {
        if (isMounted) {
          cleanup = unsubscribe
          return
        }

        unsubscribe()
      })
      .catch((error: unknown) => {
        console.error('Failed to subscribe to game state', error)
      })

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [gameId, storageAdapter])

  useEffect(() => {
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false
      return
    }

    void Promise.resolve(storageAdapter.saveGameState(gameState, gameId)).catch((error: unknown) => {
      console.error('Failed to save game state', error)
    })
  }, [gameId, gameState, storageAdapter])

  const drawLine = (start: SnappedPoint, end: SnappedPoint) => {
    setGameState((currentState) => {
      if (currentState.winner || currentState.pendingAreaChoice) {
        return currentState
      }

      const newLine: Line = {
        id: `line-${currentState.lines.length + 1}`,
        x1: start.point.x,
        y1: start.point.y,
        x2: end.point.x,
        y2: end.point.y,
        color: currentState.currentPlayer,
        choice: 0,
      }
      const splitMoveResult = getSplitMoveResult(currentState.areas, currentState.lines, newLine)

      if (!splitMoveResult || !isSplitMoveAllowed(splitMoveResult)) {
        return currentState
      }

      const { areaToSplit, splitResult } = splitMoveResult
      const nextLines = [...currentState.lines, newLine]
      const nextAreas = currentState.areas.flatMap((area) =>
        area.id === areaToSplit.id ? splitResult.areas : [area],
      )
      const startLine = currentState.lines.find((line) => line.id === start.lineId)
      const endLine = currentState.lines.find((line) => line.id === end.lineId)
      const isScoringSplit =
        startLine?.color === currentState.currentPlayer &&
        endLine?.color === currentState.currentPlayer

      if (isScoringSplit) {
        const choosingPlayer = getNextPlayer(currentState.currentPlayer)

        return {
          ...currentState,
          lines: nextLines,
          areas: nextAreas,
          currentPlayer: choosingPlayer,
          pendingAreaChoice: {
            scoringPlayer: currentState.currentPlayer,
            choosingPlayer,
            areaIds: [splitResult.areas[0].id, splitResult.areas[1].id],
          },
        }
      }

      return {
        ...currentState,
        lines: nextLines,
        areas: nextAreas,
        currentPlayer: getNextPlayer(currentState.currentPlayer),
        turnCount: currentState.turnCount + 1,
      }
    })
  }

  const fillAreaAt = (point: Point) => {
    let didFillArea = false

    setGameState((currentState) => {
      if (currentState.winner || currentState.pendingAreaChoice) {
        return currentState
      }

      const areaToFill = currentState.areas.find(
        (area) =>
          area.color === 'neutral' &&
          isFillCaptureSizeArea(area.geometricArea) &&
          isPointInsidePolygon(point, getAreaPolygonPoints(area, currentState.lines)),
      )

      if (!areaToFill) {
        return currentState
      }

      didFillArea = true

      const nextAreas = currentState.areas.map((area) =>
        area.id === areaToFill.id ? { ...area, color: currentState.currentPlayer } : area,
      )
      const { playerScores, winner } = addScore(
        currentState.playerScores,
        currentState.currentPlayer,
        areaToFill.geometricArea,
      )

      return {
        ...currentState,
        lines: markAreaBoundaryFilled(currentState.lines, [areaToFill]),
        areas: nextAreas,
        playerScores,
        winner,
        currentPlayer: getNextPlayer(currentState.currentPlayer),
        turnCount: currentState.turnCount + 1,
      }
    })

    return didFillArea
  }

  const choosePendingArea = (areaId: string) => {
    setGameState((currentState) => {
      const pendingChoice = currentState.pendingAreaChoice

      if (!pendingChoice || !pendingChoice.areaIds.includes(areaId)) {
        return currentState
      }

      const chosenArea = currentState.areas.find((area) => area.id === areaId)

      if (!chosenArea) {
        return currentState
      }

      const nextAreas = currentState.areas.map((area) =>
        area.id === chosenArea.id ? { ...area, color: pendingChoice.scoringPlayer } : area,
      )
      const { playerScores, winner } = addScore(
        currentState.playerScores,
        pendingChoice.scoringPlayer,
        chosenArea.geometricArea,
      )

      return {
        ...currentState,
        lines: markAreaBoundaryFilled(currentState.lines, [chosenArea]),
        areas: nextAreas,
        playerScores,
        winner,
        pendingAreaChoice: null,
        currentPlayer: pendingChoice.choosingPlayer,
        turnCount: currentState.turnCount + 1,
      }
    })
  }

  const applyPieRule = () => {
    setGameState((currentState) => {
      if (currentState.turnCount !== 1 || currentState.winner || currentState.pendingAreaChoice) {
        return currentState
      }

      return {
        ...currentState,
        lines: currentState.lines.map((line) => ({
          ...line,
          color: swapColor(line.color),
        })),
        areas: currentState.areas.map((area) => ({
          ...area,
          color: swapColor(area.color),
        })),
        playerScores: {
          player1: currentState.playerScores.player2,
          player2: currentState.playerScores.player1,
        },
        currentPlayer: 'player1',
        turnCount: currentState.turnCount + 1,
      }
    })
  }

  const resetGame = () => {
    setGameState(createInitialGameState())
  }

  return {
    ...gameState,
    actions: {
      drawLine,
      fillAreaAt,
      choosePendingArea,
      applyPieRule,
      resetGame,
    },
  }
}
