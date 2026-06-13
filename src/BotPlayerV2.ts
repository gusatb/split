import {
  chooseAreaForOpponent,
  evaluateCandidateMove,
  generateCandidateMoves,
  getAreaBoundarySegments,
  getNonScore,
  getNowScore,
  type CandidateMove,
  type EvaluatedCandidateMove,
} from './BotPlayer'
import { isFillCaptureSizeArea, type GameState, type SplitResult } from './useGameState'
import type { Area, Line, PlayerColor } from './types'

export const N_DEPTH = 5
export const N_BRANCHING_AREAS = 2
export const N_BRANCHING_SPLITS = 3

const WINNING_SCORE = 50

export const getNextPlayer = (activeColor: PlayerColor): PlayerColor =>
  activeColor === 'player1' ? 'player2' : 'player1'

const getAreaPair = (splitResult: SplitResult): [Area, Area] => [
  splitResult.areas[0],
  splitResult.areas[1],
]

const addScoreSim = (
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

const markAreaBoundaryFilledSim = (lines: Line[], areas: Area[]) => {
  const boundaryCounts = areas.reduce<Record<string, number>>((counts, capturedArea) => {
    const boundarySegments = getAreaBoundarySegments(capturedArea, lines)

    boundarySegments.forEach((segment) => {
      counts[segment.lineId] = (counts[segment.lineId] ?? 0) + 1
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

export const copyGameState = (state: GameState): GameState =>
  JSON.parse(JSON.stringify(state)) as GameState

export const makeMove = (
  state: GameState,
  move: CandidateMove,
  activeColor: PlayerColor,
): GameState => {
  const base = copyGameState(state)

  if (base.winner) {
    return base
  }

  if (move.kind === 'fill') {
    const area = base.areas.find((candidate) => candidate.id === move.area.id)

    if (!area || area.color !== 'neutral') {
      return base
    }

    const capturedArea = { ...area, color: activeColor }
    const { playerScores, winner } = addScoreSim(base.playerScores, activeColor, area.geometricArea)

    return {
      ...base,
      lines: markAreaBoundaryFilledSim(base.lines, [capturedArea]),
      areas: base.areas.map((candidate) => (candidate.id === area.id ? capturedArea : candidate)),
      playerScores,
      winner,
      currentPlayer: getNextPlayer(activeColor),
      turnCount: base.turnCount + 1,
      pendingAreaChoice: null,
    }
  }

  const simLine: Line = {
    ...move.line,
    color: activeColor,
  }
  const nextLines = [...base.lines, simLine]
  const [areaA, areaB] = getAreaPair(move.splitResult)

  if (!move.isScoringMove) {
    const nextAreas = base.areas.flatMap((area) =>
      area.id === move.area.id ? [areaA, areaB] : [area],
    )

    return {
      ...base,
      lines: nextLines,
      areas: nextAreas,
      currentPlayer: getNextPlayer(activeColor),
      turnCount: base.turnCount + 1,
      pendingAreaChoice: null,
    }
  }

  const defense = chooseAreaForOpponent(areaA, areaB, activeColor, nextLines)
  const chosen = defense.chosenForOpponent
  const splitAreas = base.areas.flatMap((area) =>
    area.id === move.area.id ? [areaA, areaB] : [area],
  )
  const nextAreas = splitAreas.map((area) =>
    area.id === chosen.id ? { ...area, color: activeColor } : area,
  )
  const coloredChosen = nextAreas.find((area) => area.id === chosen.id)

  if (!coloredChosen) {
    return base
  }

  const { playerScores, winner } = addScoreSim(
    base.playerScores,
    activeColor,
    chosen.geometricArea,
  )

  return {
    ...base,
    lines: markAreaBoundaryFilledSim(nextLines, [coloredChosen]),
    areas: nextAreas,
    playerScores,
    winner,
    currentPlayer: getNextPlayer(activeColor),
    turnCount: base.turnCount + 1,
    pendingAreaChoice: null,
  }
}

const sumNeutralSetupFor = (state: GameState, color: PlayerColor) =>
  state.areas
    .filter((area) => area.color === 'neutral')
    .reduce((total, area) => total + getNonScore(area, color, state.lines), 0)

const evaluateTerminal = (state: GameState, rootBotColor: PlayerColor): number => {
  const opponent = getNextPlayer(rootBotColor)

  if (state.winner !== null) {
    return state.winner === rootBotColor ? 1_000_000 : -1_000_000
  }

  if (state.playerScores[rootBotColor] > WINNING_SCORE) {
    return 1_000_000
  }

  if (state.playerScores[opponent] > WINNING_SCORE) {
    return -1_000_000
  }

  const rootMaterial = state.playerScores[rootBotColor]
  const rootSetup = sumNeutralSetupFor(state, rootBotColor)
  const oppMaterial = state.playerScores[opponent]
  const oppSetup = sumNeutralSetupFor(state, opponent)

  return rootMaterial + rootSetup - (oppMaterial + oppSetup)
}

export const getPrunedCandidateMoves = (
  state: GameState,
  activeColor: PlayerColor,
): CandidateMove[] => {
  const neutralAreas = state.areas.filter((area) => area.color === 'neutral')

  const rankedAreas = neutralAreas
    .map((area) => ({
      area,
      rank: getNowScore(area, activeColor, state.lines),
    }))
    .sort((first, second) => {
      if (second.rank !== first.rank) {
        return second.rank - first.rank
      }

      return first.area.id.localeCompare(second.area.id)
    })
    .slice(0, N_BRANCHING_AREAS)

  const moves: CandidateMove[] = []

  const allGenerated = generateCandidateMoves(state, activeColor)

  for (const { area } of rankedAreas) {
    if (isFillCaptureSizeArea(area.geometricArea)) {
      moves.push({ kind: 'fill', area })
      continue
    }

    const areaSplits = allGenerated.filter(
      (candidate): candidate is Extract<CandidateMove, { kind: 'split' }> =>
        candidate.kind === 'split' && candidate.area.id === area.id,
    )

    const rankedSplits = areaSplits
      .map((candidate) => ({
        move: candidate,
        rank: evaluateCandidateMove(candidate, state, activeColor).score,
      }))
      .sort((first, second) => {
        if (second.rank !== first.rank) {
          return second.rank - first.rank
        }

        return 0
      })
      .slice(0, N_BRANCHING_SPLITS)

    for (const { move } of rankedSplits) {
      moves.push(move)
    }
  }

  return moves
}

export const minimax = (
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  activeColor: PlayerColor,
  rootBotColor: PlayerColor,
): number => {
  if (depth === 0 || state.winner !== null) {
    return evaluateTerminal(state, rootBotColor)
  }

  const moves = getPrunedCandidateMoves(state, activeColor)

  if (moves.length === 0) {
    return evaluateTerminal(state, rootBotColor)
  }

  const isMaximizer = activeColor === rootBotColor

  if (isMaximizer) {
    let value = Number.NEGATIVE_INFINITY
    let nextAlpha = alpha

    for (const move of moves) {
      const child = makeMove(state, move, activeColor)
      value = Math.max(
        value,
        minimax(child, depth - 1, nextAlpha, beta, getNextPlayer(activeColor), rootBotColor),
      )
      nextAlpha = Math.max(nextAlpha, value)

      if (beta <= nextAlpha) {
        break
      }
    }

    return value
  }

  let value = Number.POSITIVE_INFINITY
  let nextBeta = beta

  for (const move of moves) {
    const child = makeMove(state, move, activeColor)
    value = Math.min(
      value,
      minimax(child, depth - 1, alpha, nextBeta, getNextPlayer(activeColor), rootBotColor),
    )
    nextBeta = Math.min(nextBeta, value)

    if (nextBeta <= alpha) {
      break
    }
  }

  return value
}

export const getBestBotV2Move = (
  gameState: GameState,
  botColor: PlayerColor,
): EvaluatedCandidateMove | null => {
  const moves = getPrunedCandidateMoves(gameState, botColor)

  if (moves.length === 0) {
    return null
  }

  let bestMove: CandidateMove | null = null
  let bestValue = Number.NEGATIVE_INFINITY

  for (const move of moves) {
    const child = makeMove(copyGameState(gameState), move, botColor)
    const value = minimax(
      child,
      N_DEPTH - 1,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      getNextPlayer(botColor),
      botColor,
    )

    if (value > bestValue) {
      bestValue = value
      bestMove = move
    }
  }

  if (!bestMove) {
    return null
  }

  return evaluateCandidateMove(bestMove, gameState, botColor)
}
