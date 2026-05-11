import { useState } from 'react'
import type { Area, Line } from './types'

const BOARD_UNITS = 10
const CANVAS_SIZE = 600

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
}

const createInitialGameState = (): GameState => ({
  board: {
    boardUnits: BOARD_UNITS,
    canvasSize: CANVAS_SIZE,
    pixelsPerUnit: CANVAS_SIZE / BOARD_UNITS,
  },
  lines: createInitialLines(),
  areas: [],
})

export function useGameState() {
  const [gameState] = useState<GameState>(() => createInitialGameState())

  return gameState
}
