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
import type {
  Area,
  AreaInspectionSnapshot,
  Line,
  LineColor,
  PlayerColor,
  Point,
} from './types'

interface GameCanvasProps {
  board: BoardConfig
  lines: Line[]
  areas: Area[]
  currentPlayer: PlayerColor
  pendingAreaChoice: PendingAreaChoice | null
  inspectionMode: boolean
  inspectionAreas: AreaInspectionSnapshot[]
  inspectedAreaId: string | null
  onDrawLine: (start: SnappedPoint, end: SnappedPoint) => void
  onFillArea: (point: Point) => boolean
  onChoosePendingArea: (areaId: string) => void
  onInspectAreaChange: (area: AreaInspectionSnapshot | null) => void
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
const MIN_CANVAS_SIZE = 160

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

  const availableViewportSize =
    Math.min(window.innerWidth, window.innerHeight, maximumSize) - MOBILE_CANVAS_PADDING

  return Math.max(MIN_CANVAS_SIZE, availableViewportSize)
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
  inspectionMode,
  inspectionAreas,
  inspectedAreaId,
  onDrawLine,
  onFillArea,
  onChoosePendingArea,
  onInspectAreaChange,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const [canvasSize, setCanvasSize] = useState(() => getResponsiveCanvasSize(board.canvasSize))
  const [hoveredSnapPoint, setHoveredSnapPoint] = useState<SnappedPoint | null>(null)
  const [selectedSnapPoint, setSelectedSnapPoint] = useState<SnappedPoint | null>(null)
  const [inspectionPoint, setInspectionPoint] = useState<Point | null>(null)
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

    if (inspectionMode && inspectedAreaId) {
      const inspectedArea = inspectionAreas.find((area) => area.id === inspectedAreaId)

      if (inspectedArea) {
        const polygonPoints = inspectedArea.polygon.map((point) =>
          toCanvasPoint(point, renderBoard),
        )

        if (polygonPoints.length >= 3) {
          context.beginPath()
          context.moveTo(polygonPoints[0].x, polygonPoints[0].y)
          polygonPoints.slice(1).forEach((point) => context.lineTo(point.x, point.y))
          context.closePath()
          context.fillStyle = 'rgba(250, 204, 21, 0.24)'
          context.strokeStyle = '#ca8a04'
          context.lineWidth = 3
          context.fill()
          context.stroke()
        }
      }
    }

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

    if (inspectionMode && inspectionPoint) {
      const canvasPoint = toCanvasPoint(inspectionPoint, renderBoard)

      context.beginPath()
      context.arc(canvasPoint.x, canvasPoint.y, 8, 0, Math.PI * 2)
      context.fillStyle = '#facc15'
      context.strokeStyle = '#111827'
      context.lineWidth = 2
      context.fill()
      context.stroke()
    }
  }, [
    areas,
    currentPlayer,
    hoveredSnapPoint,
    lines,
    inspectedAreaId,
    inspectionAreas,
    inspectionMode,
    inspectionPoint,
    pendingAreaChoice?.areaIds,
    preview,
    renderBoard,
    selectedSnapPoint,
  ])

  const isPointerInsideCanvas = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const bounds = canvas.getBoundingClientRect()

    return (
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom
    )
  }

  const getBoardPointFromPointerEvent = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget
    const bounds = canvas.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * renderBoard.boardUnits
    const y = ((event.clientY - bounds.top) / bounds.height) * renderBoard.boardUnits

    return { x, y }
  }

  const resetPointerTurn = () => {
    setHoveredSnapPoint(null)
    setSelectedSnapPoint(null)
  }

  const updateInspectionIndicator = (point: Point | null) => {
    setInspectionPoint(point)

    if (!point) {
      onInspectAreaChange(null)
      return
    }

    onInspectAreaChange(
      inspectionAreas.find((area) => isPointInsidePolygon(point, area.polygon)) ?? null,
    )
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

    if (
      activePointerIdRef.current !== null &&
      activePointerIdRef.current !== event.pointerId
    ) {
      return
    }

    const boardPoint = getBoardPointFromPointerEvent(event)

    if (inspectionMode) {
      updateInspectionIndicator(boardPoint)
      return
    }

    if (pendingAreaChoice) {
      setHoveredSnapPoint(null)
      return
    }

    const closestSnapPoint = findClosestSnapPoint(boardPoint, selectedSnapPoint?.lineId)

    setHoveredSnapPoint(closestSnapPoint)
  }

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()

    if (activePointerIdRef.current !== null) {
      return
    }

    activePointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)

    const boardPoint = getBoardPointFromPointerEvent(event)

    if (inspectionMode) {
      updateInspectionIndicator(boardPoint)
      return
    }

    const closestSnapPoint = findClosestSnapPoint(boardPoint, selectedSnapPoint?.lineId)
    setHoveredSnapPoint(closestSnapPoint)
  }

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()

    if (activePointerIdRef.current !== event.pointerId) {
      return
    }

    activePointerIdRef.current = null

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (!isPointerInsideCanvas(event)) {
      if (inspectionMode) {
        updateInspectionIndicator(null)
        return
      }

      resetPointerTurn()
      return
    }

    const boardPoint = getBoardPointFromPointerEvent(event)

    if (inspectionMode) {
      updateInspectionIndicator(boardPoint)
      return
    }

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

    const closestSnapPoint = findClosestSnapPoint(boardPoint, selectedSnapPoint?.lineId)
    setHoveredSnapPoint(closestSnapPoint)

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

  const handlePointerCancel = (event: PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return
    }

    activePointerIdRef.current = null

    if (inspectionMode) {
      updateInspectionIndicator(null)
      return
    }

    resetPointerTurn()
  }

  const handlePointerLeave = () => {
    if (inspectionMode) {
      updateInspectionIndicator(null)
      return
    }

    if (activePointerIdRef.current !== null) {
      return
    }

    setHoveredSnapPoint(null)
  }

  return (
    <canvas
      ref={canvasRef}
      width={renderBoard.canvasSize}
      height={renderBoard.canvasSize}
      className={inspectionMode ? 'game-canvas inspecting' : 'game-canvas'}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
      aria-label={`${renderBoard.boardUnits} by ${renderBoard.boardUnits} game board`}
    />
  )
}
