import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import {
  GEOMETRY_EPSILON,
  doLinesIntersect,
  getDistance,
  isPointOnLineSegment,
} from './geometry'
import {
  buildLegalLineSegments,
  getClosestPointOnSegment,
  isLegalLineSegment,
} from './lineSegments'
import { optimizeEvenSplitEndpoints, optimizeSplitFiveEndpoints } from './chordOptimization'
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
  showAreas: boolean
  inspectionAreas: AreaInspectionSnapshot[]
  inspectedAreaId: string | null
  interactionDisabled: boolean
  onDrawLine: (start: SnappedPoint, end: SnappedPoint) => void
  onFillArea: (point: Point) => boolean
  onChoosePendingArea: (areaId: string) => void
  onInspectAreaChange: (area: AreaInspectionSnapshot | null) => void
}

const MIN_LINE_LENGTH = 0.1
const MOBILE_CANVAS_PADDING = 24
const MIN_CANVAS_SIZE = 160
const BOARD_PADDING_UNITS = 0.75

const toCanvasPoint = (point: Point, board: RenderBoard): Point => ({
  x: (point.x + board.boardPaddingUnits) * board.pixelsPerUnit,
  y: (point.y + board.boardPaddingUnits) * board.pixelsPerUnit,
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

const canLineIntersectionBeIgnored = (line: Line, previewLine: Line) => {
  const previewStart = { x: previewLine.x1, y: previewLine.y1 }
  const previewEnd = { x: previewLine.x2, y: previewLine.y2 }

  return (
    isPointOnLineSegment(previewStart, line) ||
    isPointOnLineSegment(previewEnd, line)
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

const hasInvalidLineConflict = (previewLine: Line, start: SnappedPoint, end: SnappedPoint, lines: Line[]) =>
  lines.some((line) => {
    if (line.id === start.lineId || line.id === end.lineId) {
      return doLinesOverlap(line, previewLine)
    }

    if (doLinesOverlap(line, previewLine)) {
      return true
    }

    return doLinesIntersect(line, previewLine) && !canLineIntersectionBeIgnored(line, previewLine)
  })

const canPreviewMove = (
  start: SnappedPoint,
  end: SnappedPoint,
  lines: Line[],
  areas: Area[],
) => {
  if (start.lineId === end.lineId) {
    return false
  }

  if (getDistance(start.point, end.point) < MIN_LINE_LENGTH) {
    return false
  }

  const previewLine = createPreviewLine(start, end)

  if (hasInvalidLineConflict(previewLine, start, end, lines)) {
    return false
  }

  return getSplitMoveResult(areas, lines, previewLine) !== null
}

const isPreviewValid = (
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

type SplitOverlayModel = {
  parentId: string
  allowsChordTools: boolean
  poly0: Point[]
  poly1: Point[]
  area0: number
  area1: number
}

export function GameCanvas({
  theme,
  board,
  lines,
  areas,
  currentPlayer,
  pendingAreaChoice,
  showAreas,
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
  const [committedEndSnap, setCommittedEndSnap] = useState<SnappedPoint | null>(null)
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
  const chordEndSnap = useMemo(() => {
    if (!selectedSnapPoint) {
      return null
    }

    if (hoveredSnapPoint && isPreviewValid(selectedSnapPoint, hoveredSnapPoint, lines, areas)) {
      return hoveredSnapPoint
    }

    if (committedEndSnap && isPreviewValid(selectedSnapPoint, committedEndSnap, lines, areas)) {
      return committedEndSnap
    }

    return null
  }, [areas, committedEndSnap, hoveredSnapPoint, lines, selectedSnapPoint])

  const preview = useMemo(() => {
    if (!selectedSnapPoint || !chordEndSnap) {
      return null
    }

    const valid = isPreviewValid(selectedSnapPoint, chordEndSnap, lines, areas)

    return {
      line: createPreviewLine(selectedSnapPoint, chordEndSnap),
      isValid: valid,
    }
  }, [areas, chordEndSnap, lines, selectedSnapPoint])

  const splitOverlay = useMemo((): SplitOverlayModel | null => {
    if (!selectedSnapPoint || !chordEndSnap) {
      return null
    }

    if (!isPreviewValid(selectedSnapPoint, chordEndSnap, lines, areas)) {
      return null
    }

    const previewLine = createPreviewLine(selectedSnapPoint, chordEndSnap)
    const split = getSplitMoveResult(areas, lines, previewLine)

    if (!split) {
      return null
    }

    const linesWithPreview = [...lines, previewLine]
    const [c0, c1] = split.splitResult.areas

    return {
      parentId: split.areaToSplit.id,
      allowsChordTools: split.areaToSplit.geometricArea >= FILL_CAPTURE_LIMIT,
      poly0: getAreaPolygonPoints(c0, linesWithPreview),
      poly1: getAreaPolygonPoints(c1, linesWithPreview),
      area0: c0.geometricArea,
      area1: c1.geometricArea,
    }
  }, [areas, chordEndSnap, lines, selectedSnapPoint])

  const evenSplitTarget = useMemo(() => {
    if (!selectedSnapPoint || !chordEndSnap) {
      return null
    }

    const split = getSplitMoveResult(areas, lines, createPreviewLine(selectedSnapPoint, chordEndSnap))

    if (!split || split.areaToSplit.geometricArea < FILL_CAPTURE_LIMIT) {
      return null
    }

    return optimizeEvenSplitEndpoints(selectedSnapPoint, chordEndSnap, lines, areas)
  }, [areas, chordEndSnap, lines, selectedSnapPoint])

  const splitFiveTarget = useMemo(() => {
    if (!selectedSnapPoint || !chordEndSnap) {
      return null
    }

    const split = getSplitMoveResult(areas, lines, createPreviewLine(selectedSnapPoint, chordEndSnap))

    if (!split || split.areaToSplit.geometricArea < FILL_CAPTURE_LIMIT) {
      return null
    }

    return optimizeSplitFiveEndpoints(selectedSnapPoint, chordEndSnap, lines, areas)
  }, [areas, chordEndSnap, lines, selectedSnapPoint])

  const chordToolbarVisible = Boolean(selectedSnapPoint && chordEndSnap && preview?.isValid)

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

    resetCanvasEffects(context)
    context.clearRect(0, 0, renderBoard.canvasSize, renderBoard.canvasSize)
    context.fillStyle = theme.background
    context.fillRect(0, 0, renderBoard.canvasSize, renderBoard.canvasSize)

    const showAreaLabels = showAreas || (pendingAreaChoice?.areaIds.length ?? 0) > 0

    const overlay = splitOverlay
    const parentIdForPreview = overlay?.parentId

    areas.forEach((area) => {
      resetCanvasEffects(context)
      const areaPolygon = getAreaPolygonPoints(area, lines)
      const polygonPoints = areaPolygon.map((point) => toCanvasPoint(point, renderBoard))

      if (polygonPoints.length < 3) {
        return
      }

      const isPendingChoice = pendingAreaChoice?.areaIds.includes(area.id) ?? false
      const isFreeTakeArea = area.color === 'neutral' && area.geometricArea < FILL_CAPTURE_LIMIT
      const hideParentOverlay =
        parentIdForPreview !== undefined && area.id === parentIdForPreview && showAreaLabels

      context.beginPath()
      context.moveTo(polygonPoints[0].x, polygonPoints[0].y)
      polygonPoints.slice(1).forEach((point) => context.lineTo(point.x, point.y))
      context.closePath()
      context.fillStyle = isPendingChoice
        ? theme.pendingFill
        : getAreaFill(theme, area.color)
      context.fill()

      if (isFreeTakeArea && !hideParentOverlay) {
        resetCanvasEffects(context)
        context.fillStyle = theme.freeFill
        context.strokeStyle = theme.freeStroke
        context.lineWidth = 2
        context.fill()
        context.stroke()
      }

      if (showAreaLabels && !hideParentOverlay) {
        const labelPoint = toCanvasPoint(getPolygonCentroid(areaPolygon), renderBoard)
        const labelLines = [
          area.geometricArea.toFixed(1),
          ...(showAreas && isFreeTakeArea ? ['fill'] : []),
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

    if (overlay && showAreaLabels) {
      const drawPreviewFragment = (poly: Point[], label: string) => {
        const pts = poly.map((point) => toCanvasPoint(point, renderBoard))

        if (pts.length < 3) {
          return
        }

        context.save()
        context.globalAlpha = 0.42
        context.beginPath()
        context.moveTo(pts[0].x, pts[0].y)
        pts.slice(1).forEach((point) => context.lineTo(point.x, point.y))
        context.closePath()
        context.fillStyle = getAreaFill(theme, 'neutral')
        context.fill()
        context.restore()

        const labelPoint = toCanvasPoint(getPolygonCentroid(poly), renderBoard)
        resetCanvasEffects(context)
        context.fillStyle = theme.text
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.font = '700 18px system-ui, sans-serif'
        context.fillText(label, labelPoint.x, labelPoint.y)
      }

      drawPreviewFragment(overlay.poly0, overlay.area0.toFixed(1))
      drawPreviewFragment(overlay.poly1, overlay.area1.toFixed(1))
    }

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

    if (showAreas && inspectedAreaId) {
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

    if (preview) {
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

    if (showAreas && inspectionPoint) {
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
    inspectionPoint,
    pendingAreaChoice?.areaIds,
    preview,
    renderBoard,
    selectedSnapPoint,
    showAreas,
    splitOverlay,
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

  const resetPointerTurn = () => {
    setHoveredSnapPoint(null)
    setSelectedSnapPoint(null)
    setCommittedEndSnap(null)
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

  const confirmChord = () => {
    if (!selectedSnapPoint) {
      return
    }

    const end =
      hoveredSnapPoint && isPreviewValid(selectedSnapPoint, hoveredSnapPoint, lines, areas)
        ? hoveredSnapPoint
        : committedEndSnap && isPreviewValid(selectedSnapPoint, committedEndSnap, lines, areas)
          ? committedEndSnap
          : null

    if (!end) {
      return
    }

    onDrawLine(selectedSnapPoint, end)
    resetPointerTurn()
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

    if (showAreas) {
      updateInspectionIndicator(boardPoint)
    }

    if (interactionDisabled) {
      setHoveredSnapPoint(null)
      return
    }

    if (pendingAreaChoice) {
      setHoveredSnapPoint(null)
      return
    }

    const closestSnapPoint = findClosestSnapPoint(
      boardPoint,
      selectedSnapPoint?.lineId,
      selectedSnapPoint,
    )

    setHoveredSnapPoint(closestSnapPoint)

    if (
      selectedSnapPoint &&
      closestSnapPoint &&
      isPreviewValid(selectedSnapPoint, closestSnapPoint, lines, areas)
    ) {
      setCommittedEndSnap(closestSnapPoint)
    }
  }

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()

    if (activePointerIdRef.current !== null) {
      return
    }

    activePointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)

    const boardPoint = getBoardPointFromPointerEvent(event)

    if (showAreas) {
      updateInspectionIndicator(boardPoint)
    }

    if (interactionDisabled) {
      resetPointerTurn()
      return
    }

    const closestSnapPoint = findClosestSnapPoint(
      boardPoint,
      selectedSnapPoint?.lineId,
      selectedSnapPoint,
    )
    setHoveredSnapPoint(closestSnapPoint)

    if (
      selectedSnapPoint &&
      closestSnapPoint &&
      isPreviewValid(selectedSnapPoint, closestSnapPoint, lines, areas)
    ) {
      setCommittedEndSnap(closestSnapPoint)
    }
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
      if (showAreas) {
        updateInspectionIndicator(null)
      }

      if (!showAreas) {
        resetPointerTurn()
      }

      return
    }

    const boardPoint = getBoardPointFromPointerEvent(event)

    if (showAreas) {
      updateInspectionIndicator(boardPoint)
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

    const closestSnapPoint = findClosestSnapPoint(
      boardPoint,
      selectedSnapPoint?.lineId,
      selectedSnapPoint,
    )
    setHoveredSnapPoint(closestSnapPoint)

    if (
      selectedSnapPoint &&
      closestSnapPoint &&
      isPreviewValid(selectedSnapPoint, closestSnapPoint, lines, areas)
    ) {
      setCommittedEndSnap(closestSnapPoint)
    }

    if (!closestSnapPoint) {
      if (!selectedSnapPoint && onFillArea(boardPoint)) {
        setHoveredSnapPoint(null)
        return
      }

      setSelectedSnapPoint(null)
      setCommittedEndSnap(null)
      return
    }

    if (!selectedSnapPoint) {
      setSelectedSnapPoint(closestSnapPoint)
      setCommittedEndSnap(null)
      return
    }

    if (isPreviewValid(selectedSnapPoint, closestSnapPoint, lines, areas)) {
      return
    }

    resetPointerTurn()
  }

  const handlePointerCancel = (event: PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return
    }

    activePointerIdRef.current = null

    if (showAreas) {
      updateInspectionIndicator(null)
    }

    resetPointerTurn()
  }

  const handlePointerLeave = () => {
    if (showAreas) {
      updateInspectionIndicator(null)
    }

    if (activePointerIdRef.current !== null) {
      return
    }

    setHoveredSnapPoint(null)
  }

  return (
    <div className="game-canvas-stack">
      <canvas
        ref={canvasRef}
        width={renderBoard.canvasSize}
        height={renderBoard.canvasSize}
        className={showAreas ? 'game-canvas game-canvas--show-areas' : 'game-canvas'}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        aria-label={`${renderBoard.boardUnits} by ${renderBoard.boardUnits} game board`}
      />

      {chordToolbarVisible ? (
        <div className="chord-toolbar" role="group" aria-label="Chord preview actions">
          <button type="button" className="game-button secondary" onClick={resetPointerTurn}>
            Cancel
          </button>
          {splitOverlay?.allowsChordTools ? (
            <>
              <button
                type="button"
                className="game-button secondary"
                disabled={!evenSplitTarget}
                onClick={() => {
                  if (evenSplitTarget) {
                    setHoveredSnapPoint(evenSplitTarget)
                    setCommittedEndSnap(evenSplitTarget)
                  }
                }}
              >
                Even split
              </button>
              <button
                type="button"
                className="game-button secondary"
                disabled={!splitFiveTarget}
                onClick={() => {
                  if (splitFiveTarget) {
                    setHoveredSnapPoint(splitFiveTarget)
                    setCommittedEndSnap(splitFiveTarget)
                  }
                }}
              >
                Split 5
              </button>
            </>
          ) : null}
          <button type="button" className="game-button primary" onClick={confirmChord}>
            Confirm
          </button>
        </div>
      ) : null}
    </div>
  )
}
