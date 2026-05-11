import { useEffect, useRef } from 'react'
import type { MouseEvent } from 'react'
import type { BoardConfig } from './useGameState'
import type { Line, LineColor } from './types'

interface GameCanvasProps {
  board: BoardConfig
  lines: Line[]
}

const lineColors: Record<LineColor, string> = {
  neutral: '#111827',
  player1: '#2563eb',
  player2: '#dc2626',
}

export function GameCanvas({ board, lines }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.clearRect(0, 0, board.canvasSize, board.canvasSize)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, board.canvasSize, board.canvasSize)

    lines.forEach((line) => {
      context.beginPath()
      context.moveTo(line.x1 * board.pixelsPerUnit, line.y1 * board.pixelsPerUnit)
      context.lineTo(line.x2 * board.pixelsPerUnit, line.y2 * board.pixelsPerUnit)
      context.strokeStyle = lineColors[line.color]
      context.lineWidth = line.color === 'neutral' ? 4 : 3
      context.lineCap = 'round'
      context.stroke()
    })
  }, [board, lines])

  const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    const { offsetX, offsetY } = event.nativeEvent

    // TODO: Use the current pointer position to find the closest legal point on existing lines.
    void offsetX
    void offsetY
  }

  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const { offsetX, offsetY } = event.nativeEvent

    // TODO: Validate whether the snapped point can be used as a line endpoint before creating a new line.
    void offsetX
    void offsetY
  }

  return (
    <canvas
      ref={canvasRef}
      width={board.canvasSize}
      height={board.canvasSize}
      className="game-canvas"
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      aria-label={`${board.boardUnits} by ${board.boardUnits} game board`}
    />
  )
}
