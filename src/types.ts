export type LineColor = 'neutral' | 'player1' | 'player2'
export type AreaColor = 'neutral' | 'player1' | 'player2'
export type PlayerColor = 'player1' | 'player2'
export type LineChoice = 0 | 1 | 2
export type Endpoint = 1 | 2

export interface Point {
  x: number
  y: number
}

export interface Line {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  color: LineColor
  choice: LineChoice
  filledSides?: {
    left: boolean
    right: boolean
  }
}

export interface PointReference {
  lineId: string
  endpoint: Endpoint
}

export interface Area {
  id: string
  color: AreaColor
  points: PointReference[]
  geometricArea: number
}

export interface AreaInspectionSnapshot {
  id: string
  color: AreaColor
  geometricArea: number
  polygon: Point[]
}

export interface LegalLineSegment {
  id: string
  lineId: string
  start: Point
  end: Point
  leftAreaScored: boolean
  rightAreaScored: boolean
}
