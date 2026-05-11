export type LineColor = 'neutral' | 'player1' | 'player2'
export type PlayerColor = 'player1' | 'player2'
export type LineChoice = 0 | 1 | 2
export type Endpoint = 1 | 2

export interface Line {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  color: LineColor
  choice: LineChoice
}

export interface PointReference {
  lineId: string
  endpoint: Endpoint
}

export interface Area {
  id: string
  color: PlayerColor
  points: PointReference[]
  geometricArea: number
}
