import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import {
  canPreviewMove,
  createPreviewLine,
  isPreviewValid,
} from './chordPreview'
import { optimizeEvenSplitEndpoints } from './evenSplitChord'
import { getDistance } from './geometry'
import {
  buildLegalLineSegments,
  getClosestPointOnSegment,
  isLegalLineSegment,
} from './lineSegments'
import { getAreaFill, getLineStroke, type ThemeConfig } from './themes'
import {
  FILL_CAPTURE_LIMIT,
  getAreaPolygonPoints,
  getSplitMoveResult,
  isSplitMoveAllowed,
  isPointInsidePolygon,
  type BoardConfig,
  type PendingAreaChoice,
  type SnappedPoint,
} from './useGameState'
import type {
  Area,
  AreaInspectionSnapshot,
  Line,
  PlayerColor,
  Point,
} from './types'

interface RenderBoard extends BoardConfig {
  boardPaddingUnits: number
}

interface GameCanvasProps {
  theme: ThemeConfig
  board: BoardConfig
  lines: Line[]
  areas: Area[]
  currentPlayer: PlayerColor
  pendingAreaChoice: PendingAreaChoice | null
  inspectionMode: boolean
  inspectionAreas: AreaInspectionSnapshot[]
  inspectedAreaId: string | null
  interactionDisabled: boolean
  onDrawLine: (start: SnappedPoint, end: SnappedPoint) => void
  onFillArea: (point: Point) => boolean
  onChoosePendingArea: (areaId: string) => void
  onInspectAreaChange: (area: AreaInspectionSnapshot | null) => void
}

const MOBILE_CANVAS_PADDING = 24
const MIN_CANVAS_SIZE = 160
const BOARD_PADDING_UNITS = 0.75

type ChordPreviewModel = {
  line: Line
  isValid: boolean
  splitFragments: [Area, Area] | null
  isFillCapturePreview: boolean
  fillCaptureParentArea: Area | null
}

const buildChordPreview = (
  start: SnappedPoint,
  end: SnappedPoint,
  lines: Line[],
  areas: Area[],
): ChordPreviewModel => {
  const line = createPreviewLine(start, end)
  const isValid = isPreviewValid(start, end, lines, areas)
  let splitFragments: [Area, Area] | null = null
  let isFillCapturePreview = false
  let fillCaptureParentArea: Area | null = null

  if (isValid) {
    const splitMoveResult = getSplitMoveResult(areas, lines, line)

    if (splitMoveResult && isSplitMoveAllowed(splitMoveResult)) {
      if (splitMoveResult.areaToSplit.geometricArea <= FILL_CAPTURE_LIMIT) {
        isFillCapturePreview = true
        fillCaptureParentArea = splitMoveResult.areaToSplit
      } else {
        splitFragments = splitMoveResult.splitResult.areas
      }
    }
  }

  return { line, isValid, splitFragments, isFillCapturePreview, fillCaptureParentArea }
}

const toCanvasPoint = (point: Point, board: RenderBoard): Point => ({
  x: (point.x + board.boardPaddingUnits) * board.pixelsPerUnit,
  y: (point.y + board.boardPaddingUnits) * board.pixelsPerUnit,
})

const getResponsiveCanvasSize = (maximumSize: number) => {
  if (typeof window === 'undefined') {
    return maximumSize
  }

  const availableViewportSize =
    Math.min(window.innerWidth, window.innerHeight, maximumSize) - MOBILE_CANVAS_PADDING

  return Math.max(MIN_CANVAS_SIZE, availableViewportSize)
}

const getPolygonCentroid = (points: Point[]) => {
  const pointTotal = points.reduce(
    (total, point) => ({
      x: total.x + point.x,
      y: total.y + point.y,
    }),
    { x: 0, y: 0 },
  )

  return {
    x: pointTotal.x / points.length,
    y: pointTotal.y / points.length,
  }
}

const resetCanvasEffects = (context: CanvasRenderingContext2D) => {
  context.shadowColor = 'transparent'
  context.shadowBlur = 0
  context.shadowOffsetX = 0
  context.shadowOffsetY = 0
}

const applyStrokeEffects = (
  context: CanvasRenderingContext2D,
  theme: ThemeConfig,
  stroke: string,
) => {
  context.shadowBlur = theme.effects.shadowBlur
  context.shadowColor = theme.effects.shadowColor === 'stroke' ? stroke : theme.effects.shadowColor
  context.shadowOffsetX = theme.effects.shadowOffsetX
  context.shadowOffsetY = theme.effects.shadowOffsetY
}

export function GameCanvas({
  theme,
  board,
  lines,
  areas,
  currentPlayer,
  pendingAreaChoice,
  inspectionMode,
  inspectionAreas,
  inspectedAreaId,
  interactionDisabled,
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
  const [pendingChord, setPendingChord] = useState<{
    start: SnappedPoint
    end: SnappedPoint
  } | null>(null)
  const [inspectionPoint, setInspectionPoint] = useState<Point | null>(null)
  const legalLineSegments = useMemo(() => buildLegalLineSegments(lines, areas), [areas, lines])
  const renderBoard: RenderBoard = useMemo(
    () => ({
      ...board,
      boardPaddingUnits: BOARD_PADDING_UNITS,
      canvasSize,
      pixelsPerUnit: canvasSize / (board.boardUnits + BOARD_PADDING_UNITS * 2),
    }),
    [board, canvasSize],
  )
  const preview = useMemo((): ChordPreviewModel | null => {
    if (pendingChord) {
      return buildChordPreview(pendingChord.start, pendingChord.end, lines, areas)
    }

    if (!selectedSnapPoint || !hoveredSnapPoint) {
      return null
    }

    return buildChordPreview(selectedSnapPoint, hoveredSnapPoint, lines, areas)
  }, [areas, hoveredSnapPoint, lines, pendingChord, selectedSnapPoint])

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
    if (!interactionDisabled) {
      return
    }

    const frameId = requestAnimationFrame(() => {
      setPendingChord(null)
      setHoveredSnapPoint(null)
      setSelectedSnapPoint(null)
    })

    return () => cancelAnimationFrame(frameId)
  }, [interactionDisabled])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    resetCanvasEffects(context)
    context.clearRect(0, 0, renderBoard.canvasSize, renderBoard.canvasSize)
    context.fillStyle = theme.background
    context.fillRect(0, 0, renderBoard.canvasSize, renderBoard.canvasSize)

    areas.forEach((area) => {
      resetCanvasEffects(context)
      const areaPolygon = getAreaPolygonPoints(area, lines)
      const polygonPoints = areaPolygon.map((point) => toCanvasPoint(point, renderBoard))

      if (polygonPoints.length < 3) {
        return
      }

      const isPendingChoice = pendingAreaChoice?.areaIds.includes(area.id) ?? false
      const isFreeTakeArea =
        area.color === 'neutral' && area.geometricArea <= FILL_CAPTURE_LIMIT

      context.beginPath()
      context.moveTo(polygonPoints[0].x, polygonPoints[0].y)
      polygonPoints.slice(1).forEach((point) => context.lineTo(point.x, point.y))
      context.closePath()
      context.fillStyle = isPendingChoice
        ? theme.pendingFill
        : getAreaFill(theme, area.color)
      context.fill()

      if (isFreeTakeArea) {
        resetCanvasEffects(context)
        context.shadowColor = theme.freeAreaGlow.color
        context.shadowBlur = theme.freeAreaGlow.blur
        context.shadowOffsetX = 0
        context.shadowOffsetY = 0
        context.fillStyle = theme.freeFill
        context.strokeStyle = theme.freeStroke
        context.lineWidth = 2
        context.fill()
        context.stroke()
        resetCanvasEffects(context)
      }

      if (inspectionMode || isPendingChoice) {
        const labelPoint = toCanvasPoint(getPolygonCentroid(areaPolygon), renderBoard)
        const labelLines = [
          area.geometricArea.toFixed(1),
          ...(inspectionMode && isFreeTakeArea ? ['free'] : []),
        ]

        resetCanvasEffects(context)
        context.fillStyle = isFreeTakeArea ? theme.freeStroke : theme.text
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        labelLines.forEach((label, index) => {
          context.font =
            index === 0 ? '700 18px system-ui, sans-serif' : '700 12px system-ui, sans-serif'
          context.fillText(
            label,
            labelPoint.x,
            labelPoint.y + (index - (labelLines.length - 1) / 2) * 16,
          )
        })
      }
    })

    lines.forEach((line) => {
      const lineStart = toCanvasPoint({ x: line.x1, y: line.y1 }, renderBoard)
      const lineEnd = toCanvasPoint({ x: line.x2, y: line.y2 }, renderBoard)
      const stroke = getLineStroke(theme, line.color)

      context.beginPath()
      context.moveTo(lineStart.x, lineStart.y)
      context.lineTo(lineEnd.x, lineEnd.y)
      context.strokeStyle = stroke
      context.lineWidth = line.color === 'neutral' ? 4 : 3
      context.lineCap = 'round'
      applyStrokeEffects(context, theme, stroke)
      context.stroke()
      resetCanvasEffects(context)
    })

    if (inspectionMode && inspectedAreaId) {
      resetCanvasEffects(context)
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
          context.fillStyle = theme.pendingFill
          context.strokeStyle = theme.pendingStroke
          context.lineWidth = 3
          context.fill()
          context.stroke()
        }
      }
    }

    const hidePreviewLineForFillCapture = preview?.isValid && preview.isFillCapturePreview

    if (preview && !hidePreviewLineForFillCapture) {
      const stroke = preview.isValid ? getLineStroke(theme, currentPlayer) : 'rgba(239, 68, 68, 0.72)'
      const previewStart = toCanvasPoint(
        { x: preview.line.x1, y: preview.line.y1 },
        renderBoard,
      )
      const previewEnd = toCanvasPoint(
        { x: preview.line.x2, y: preview.line.y2 },
        renderBoard,
      )

      context.beginPath()
      context.moveTo(previewStart.x, previewStart.y)
      context.lineTo(previewEnd.x, previewEnd.y)
      context.strokeStyle = stroke
      context.lineWidth = 2
      context.setLineDash(preview.isValid ? [8, 8] : [2, 6])
      applyStrokeEffects(context, theme, stroke)
      context.stroke()
      context.setLineDash([])
      resetCanvasEffects(context)
    }

    if (preview?.isFillCapturePreview && preview.isValid && preview.fillCaptureParentArea) {
      const parentPoly = getAreaPolygonPoints(preview.fillCaptureParentArea, lines)

      if (parentPoly.length >= 3) {
        const labelPoint = toCanvasPoint(getPolygonCentroid(parentPoly), renderBoard)
        const scoreLabel = preview.fillCaptureParentArea.geometricArea.toFixed(1)

        resetCanvasEffects(context)
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.font = '700 22px system-ui, sans-serif'
        context.lineWidth = 4
        context.lineJoin = 'round'
        context.miterLimit = 2
        context.strokeStyle = theme.background
        context.fillStyle = theme.text
        context.strokeText(scoreLabel, labelPoint.x, labelPoint.y)
        context.fillText(scoreLabel, labelPoint.x, labelPoint.y)
        resetCanvasEffects(context)
      }

      context.lineJoin = 'miter'
      context.miterLimit = 10
    } else if (preview?.splitFragments) {
      const linesWithPreview = [...lines, preview.line]

      for (const fragment of preview.splitFragments) {
        const fragmentPoly = getAreaPolygonPoints(fragment, linesWithPreview)

        if (fragmentPoly.length < 3) {
          continue
        }

        const labelPoint = toCanvasPoint(getPolygonCentroid(fragmentPoly), renderBoard)
        const label = fragment.geometricArea.toFixed(1)

        resetCanvasEffects(context)
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.font = '700 16px system-ui, sans-serif'
        context.lineWidth = 4
        context.lineJoin = 'round'
        context.miterLimit = 2
        context.strokeStyle = theme.background
        context.fillStyle = theme.text
        context.strokeText(label, labelPoint.x, labelPoint.y)
        context.fillText(label, labelPoint.x, labelPoint.y)
        resetCanvasEffects(context)
      }

      context.lineJoin = 'miter'
      context.miterLimit = 10
    }

    if (hoveredSnapPoint) {
      const canvasPoint = toCanvasPoint(hoveredSnapPoint.point, renderBoard)

      resetCanvasEffects(context)
      context.strokeStyle = theme.cursor === 'glowCircle' ? theme.accent : theme.neutralLine
      context.lineWidth = 2

      if (theme.cursor === 'glowCircle') {
        applyStrokeEffects(context, theme, theme.accent)
        context.beginPath()
        context.arc(canvasPoint.x, canvasPoint.y, 7, 0, Math.PI * 2)
        context.stroke()
        resetCanvasEffects(context)
      } else {
        context.beginPath()
        context.moveTo(canvasPoint.x - 7, canvasPoint.y)
        context.lineTo(canvasPoint.x + 7, canvasPoint.y)
        context.moveTo(canvasPoint.x, canvasPoint.y - 7)
        context.lineTo(canvasPoint.x, canvasPoint.y + 7)
        context.stroke()
      }
    }

    if (selectedSnapPoint) {
      const canvasPoint = toCanvasPoint(selectedSnapPoint.point, renderBoard)
      const stroke = getLineStroke(theme, currentPlayer)

      resetCanvasEffects(context)
      context.beginPath()
      context.arc(canvasPoint.x, canvasPoint.y, 7, 0, Math.PI * 2)
      context.strokeStyle = stroke
      context.lineWidth = 3
      applyStrokeEffects(context, theme, stroke)
      context.stroke()
      resetCanvasEffects(context)
    }

    if (inspectionMode && inspectionPoint) {
      const canvasPoint = toCanvasPoint(inspectionPoint, renderBoard)

      resetCanvasEffects(context)
      context.beginPath()
      context.strokeStyle = theme.accent
      context.lineWidth = 2
      if (theme.cursor === 'glowCircle') {
        applyStrokeEffects(context, theme, theme.accent)
        context.arc(canvasPoint.x, canvasPoint.y, 8, 0, Math.PI * 2)
        context.stroke()
      } else {
        context.moveTo(canvasPoint.x - 8, canvasPoint.y)
        context.lineTo(canvasPoint.x + 8, canvasPoint.y)
        context.moveTo(canvasPoint.x, canvasPoint.y - 8)
        context.lineTo(canvasPoint.x, canvasPoint.y + 8)
        context.stroke()
      }
      resetCanvasEffects(context)
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
    theme,
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

  const isPointInsideGameScreen = (point: Point) =>
    point.x >= 0 &&
    point.x <= renderBoard.boardUnits &&
    point.y >= 0 &&
    point.y <= renderBoard.boardUnits

  const getBoardPointFromPointerEvent = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget
    const bounds = canvas.getBoundingClientRect()
    const x =
      ((event.clientX - bounds.left) / bounds.width) *
        (renderBoard.boardUnits + renderBoard.boardPaddingUnits * 2) -
      renderBoard.boardPaddingUnits
    const y =
      ((event.clientY - bounds.top) / bounds.height) *
        (renderBoard.boardUnits + renderBoard.boardPaddingUnits * 2) -
      renderBoard.boardPaddingUnits

    return { x, y }
  }

  const clearChordPickInProgress = () => {
    setHoveredSnapPoint(null)
    setSelectedSnapPoint(null)
  }

  const resetPointerTurn = () => {
    clearChordPickInProgress()
    setPendingChord(null)
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

  const findClosestSnapPoint = (
    point: Point,
    excludedLineId?: string,
    moveStart?: SnappedPoint | null,
  ): SnappedPoint | null => {
    if (!isPointInsideGameScreen(point)) {
      return null
    }

    const snapCandidates = legalLineSegments
      .filter(
        (segment) =>
          segment.lineId !== excludedLineId && isLegalLineSegment(segment),
      )
      .map((segment) => {
        const snapPoint = getClosestPointOnSegment(point, segment)

        return {
          point: snapPoint,
          lineId: segment.lineId,
          distance: getDistance(point, snapPoint),
        }
      })
      .filter(
        (candidate) =>
          !moveStart || canPreviewMove(moveStart, candidate, lines, areas),
      )
      .sort((firstPoint, secondPoint) => firstPoint.distance - secondPoint.distance)
    const closestSnap = snapCandidates[0]

    if (!closestSnap) {
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

    if (interactionDisabled) {
      setHoveredSnapPoint(null)
      return
    }

    if (pendingAreaChoice) {
      setHoveredSnapPoint(null)
      return
    }

    if (pendingChord) {
      return
    }

    const closestSnapPoint = findClosestSnapPoint(
      boardPoint,
      selectedSnapPoint?.lineId,
      selectedSnapPoint,
    )

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

    if (interactionDisabled) {
      resetPointerTurn()
      return
    }

    if (pendingChord) {
      return
    }

    const closestSnapPoint = findClosestSnapPoint(
      boardPoint,
      selectedSnapPoint?.lineId,
      selectedSnapPoint,
    )
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

      if (pendingChord) {
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

    if (interactionDisabled) {
      resetPointerTurn()
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

    if (pendingChord) {
      return
    }

    const closestSnapPoint = findClosestSnapPoint(
      boardPoint,
      selectedSnapPoint?.lineId,
      selectedSnapPoint,
    )
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

    if (isPreviewValid(selectedSnapPoint, closestSnapPoint, lines, areas)) {
      setPendingChord({ start: selectedSnapPoint, end: closestSnapPoint })
      clearChordPickInProgress()
      return
    }

    clearChordPickInProgress()
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

    if (pendingChord) {
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

  const handleConfirmPendingLine = () => {
    if (!pendingChord) {
      return
    }

    if (!isPreviewValid(pendingChord.start, pendingChord.end, lines, areas)) {
      return
    }

    onDrawLine(pendingChord.start, pendingChord.end)
    setPendingChord(null)
  }

  const handleCancelPendingLine = () => {
    setPendingChord(null)
  }

  const handleEvenSplitPendingLine = () => {
    if (!pendingChord) {
      return
    }

    const optimized = optimizeEvenSplitEndpoints(
      pendingChord.start,
      pendingChord.end,
      lines,
      areas,
      legalLineSegments,
    )

    if (optimized) {
      setPendingChord(optimized)
    }
  }

  const showLineConfirmBar =
    pendingChord !== null &&
    !interactionDisabled &&
    !inspectionMode &&
    !pendingAreaChoice

  return (
    <div className="game-canvas-wrap">
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
      {showLineConfirmBar ? (
        <div className="line-confirm-bar" role="group" aria-label="Confirm line placement">
          <button type="button" className="game-button" onClick={handleConfirmPendingLine}>
            Confirm
          </button>
          {preview != null && preview.isValid && !preview.isFillCapturePreview ? (
            <button type="button" className="game-button" onClick={handleEvenSplitPendingLine}>
              Even split
            </button>
          ) : null}
          <button type="button" className="game-button secondary" onClick={handleCancelPendingLine}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
