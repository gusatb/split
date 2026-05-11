import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import {
  doLinesIntersect,
  getClosestPointOnLine,
  getDistance,
  isPointOnIntersection,
} from './geometry'
import {
  getAreaPolygonPoints,
  isPointInsidePolygon,
  type BoardConfig,
  type PendingAreaChoice,
  type SnappedPoint,
} from './useGameState'
import type { Area, Line, LineColor, PlayerColor, Point } from './types'

interface GameCanvasProps {
  board: BoardConfig
  lines: Line[]
  areas: Area[]
  currentPlayer: PlayerColor
  pendingAreaChoice: PendingAreaChoice | null
  onDrawLine: (start: SnappedPoint, end: SnappedPoint) => void
  onFillArea: (point: Point) => boolean
  onChoosePendingArea: (areaId: string) => void
}

const lineColors: Record<LineColor, string> = {
  neutral: '#111827',
  player1: '#2563eb',
  player2: '#dc2626',
}

const areaColors: Record<LineColor, string> = {
  neutral: 'rgba(255, 255, 255, 0)',
  player1: 'rgba(37, 99, 235, 0.18)',
  player2: 'rgba(220, 38, 38, 0.18)',
}

const SNAP_RADIUS = 0.75
const MIN_LINE_LENGTH = 0.1
const MOBILE_CANVAS_PADDING = 24
const MIN_CANVAS_SIZE = 280

const isLineFullyFilled = (line: Line) =>
  line.filledSides?.left === true && line.filledSides?.right === true

const toCanvasPoint = (point: Point, board: BoardConfig): Point => ({
  x: point.x * board.pixelsPerUnit,
  y: point.y * board.pixelsPerUnit,
})

const createPreviewLine = (start: SnappedPoint, end: SnappedPoint): Line => ({
  id: 'preview-line',
  x1: start.point.x,
  y1: start.point.y,
  x2: end.point.x,
  y2: end.point.y,
  color: 'neutral',
  choice: 0,
})

const getResponsiveCanvasSize = (maximumSize: number) => {
  if (typeof window === 'undefined') {
    return maximumSize
  }

  return Math.max(
    MIN_CANVAS_SIZE,
    Math.min(window.innerWidth, window.innerHeight, maximumSize) - MOBILE_CANVAS_PADDING,
  )
}

const isPreviewValid = (start: SnappedPoint, end: SnappedPoint, lines: Line[]) => {
  if (start.lineId === end.lineId) {
    return false
  }

  if (getDistance(start.point, end.point) < MIN_LINE_LENGTH) {
    return false
  }

  if (isPointOnIntersection(start.point, lines) || isPointOnIntersection(end.point, lines)) {
    return false
  }

  const previewLine = createPreviewLine(start, end)

  return !lines.some((line) => {
    if (line.id === start.lineId || line.id === end.lineId) {
      return false
    }

    return doLinesIntersect(line, previewLine)
  })
}

export function GameCanvas({
  board,
  lines,
  areas,
  currentPlayer,
  pendingAreaChoice,
  onDrawLine,
  onFillArea,
  onChoosePendingArea,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [canvasSize, setCanvasSize] = useState(() => getResponsiveCanvasSize(board.canvasSize))
  const [hoveredSnapPoint, setHoveredSnapPoint] = useState<SnappedPoint | null>(null)
  const [selectedSnapPoint, setSelectedSnapPoint] = useState<SnappedPoint | null>(null)
  const renderBoard = useMemo(
    () => ({
      ...board,
      canvasSize,
      pixelsPerUnit: canvasSize / board.boardUnits,
    }),
    [board, canvasSize],
  )
  const preview = useMemo(() => {
    if (!selectedSnapPoint || !hoveredSnapPoint) {
      return null
    }

    return {
      line: createPreviewLine(selectedSnapPoint, hoveredSnapPoint),
      isValid: isPreviewValid(selectedSnapPoint, hoveredSnapPoint, lines),
    }
  }, [hoveredSnapPoint, lines, selectedSnapPoint])

  useEffect(() => {
    const handleResize = () => {
      setCanvasSize(getResponsiveCanvasSize(board.canvasSize))
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [board.canvasSize])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.clearRect(0, 0, renderBoard.canvasSize, renderBoard.canvasSize)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, renderBoard.canvasSize, renderBoard.canvasSize)

    areas.forEach((area) => {
      const polygonPoints = getAreaPolygonPoints(area, lines).map((point) =>
        toCanvasPoint(point, renderBoard),
      )

      if (polygonPoints.length < 3) {
        return
      }

      context.beginPath()
      context.moveTo(polygonPoints[0].x, polygonPoints[0].y)
      polygonPoints.slice(1).forEach((point) => context.lineTo(point.x, point.y))
      context.closePath()
      context.fillStyle = pendingAreaChoice?.areaIds.includes(area.id)
        ? 'rgba(250, 204, 21, 0.22)'
        : areaColors[area.color]
      context.fill()
    })

    lines.forEach((line) => {
      context.beginPath()
      context.moveTo(line.x1 * renderBoard.pixelsPerUnit, line.y1 * renderBoard.pixelsPerUnit)
      context.lineTo(line.x2 * renderBoard.pixelsPerUnit, line.y2 * renderBoard.pixelsPerUnit)
      context.strokeStyle = lineColors[line.color]
      context.lineWidth = line.color === 'neutral' ? 4 : 3
      context.lineCap = 'round'
      context.stroke()
    })

    if (preview) {
      context.beginPath()
      context.moveTo(
        preview.line.x1 * renderBoard.pixelsPerUnit,
        preview.line.y1 * renderBoard.pixelsPerUnit,
      )
      context.lineTo(
        preview.line.x2 * renderBoard.pixelsPerUnit,
        preview.line.y2 * renderBoard.pixelsPerUnit,
      )
      context.strokeStyle = preview.isValid ? lineColors[currentPlayer] : '#ef4444'
      context.lineWidth = 2
      context.setLineDash([8, 8])
      context.stroke()
      context.setLineDash([])
    }

    if (hoveredSnapPoint) {
      const canvasPoint = toCanvasPoint(hoveredSnapPoint.point, renderBoard)

      context.beginPath()
      context.arc(canvasPoint.x, canvasPoint.y, 6, 0, Math.PI * 2)
      context.fillStyle = '#facc15'
      context.strokeStyle = '#854d0e'
      context.lineWidth = 2
      context.fill()
      context.stroke()
    }

    if (selectedSnapPoint) {
      const canvasPoint = toCanvasPoint(selectedSnapPoint.point, renderBoard)

      context.beginPath()
      context.arc(canvasPoint.x, canvasPoint.y, 7, 0, Math.PI * 2)
      context.fillStyle = lineColors[currentPlayer]
      context.fill()
    }
  }, [
    areas,
    currentPlayer,
    hoveredSnapPoint,
    lines,
    pendingAreaChoice?.areaIds,
    preview,
    renderBoard,
    selectedSnapPoint,
  ])

  const getBoardPointFromPointerEvent = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget
    const bounds = canvas.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * renderBoard.boardUnits
    const y = ((event.clientY - bounds.top) / bounds.height) * renderBoard.boardUnits

    return { x, y }
  }

  const findClosestSnapPoint = (point: Point, excludedLineId?: string): SnappedPoint | null => {
    const closestSnap = lines
      .filter((line) => line.id !== excludedLineId && !isLineFullyFilled(line))
      .map((line) => {
        const snapPoint = getClosestPointOnLine(point, line)

        return {
          point: snapPoint,
          lineId: line.id,
          distance: getDistance(point, snapPoint),
        }
      })
      .sort((firstPoint, secondPoint) => firstPoint.distance - secondPoint.distance)[0]

    if (!closestSnap || closestSnap.distance > SNAP_RADIUS) {
      return null
    }

    return {
      point: closestSnap.point,
      lineId: closestSnap.lineId,
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()

    if (pendingAreaChoice) {
      setHoveredSnapPoint(null)
      return
    }

    const boardPoint = getBoardPointFromPointerEvent(event)
    const closestSnapPoint = findClosestSnapPoint(boardPoint, selectedSnapPoint?.lineId)

    setHoveredSnapPoint(closestSnapPoint)
  }

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    const boardPoint = getBoardPointFromPointerEvent(event)
    const closestSnapPoint = findClosestSnapPoint(boardPoint, selectedSnapPoint?.lineId)
    setHoveredSnapPoint(closestSnapPoint)

    if (pendingAreaChoice) {
      const chosenArea = areas.find(
        (area) =>
          pendingAreaChoice.areaIds.includes(area.id) &&
          isPointInsidePolygon(boardPoint, getAreaPolygonPoints(area, lines)),
      )

      if (chosenArea) {
        onChoosePendingArea(chosenArea.id)
      }

      return
    }

    if (!closestSnapPoint) {
      if (!selectedSnapPoint && onFillArea(boardPoint)) {
        setHoveredSnapPoint(null)
        return
      }

      setSelectedSnapPoint(null)
      return
    }

    if (!selectedSnapPoint) {
      setSelectedSnapPoint(closestSnapPoint)
      return
    }

    if (isPreviewValid(selectedSnapPoint, closestSnapPoint, lines)) {
      onDrawLine(selectedSnapPoint, closestSnapPoint)
      setSelectedSnapPoint(null)
      setHoveredSnapPoint(null)
    }
  }

  const handlePointerLeave = () => {
    setHoveredSnapPoint(null)
  }

  return (
    <canvas
      ref={canvasRef}
      width={renderBoard.canvasSize}
      height={renderBoard.canvasSize}
      className="game-canvas"
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      aria-label={`${renderBoard.boardUnits} by ${renderBoard.boardUnits} game board`}
    />
  )
}
