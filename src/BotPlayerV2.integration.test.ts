import { describe, expect, it } from 'vitest'
import { generateCandidateMoves, type SplitCandidateMove } from './BotPlayer'
import { getBestBotV2Move } from './BotPlayerV2'
import { createInitialGameState, type GameState } from './useGameState'

/**
 * Applies the same board update as a non-scoring `drawLine` from `useGameState`
 * (first opening lines are neutral, so the first human split is non-scoring).
 */
const applyNonScoringSplit = (state: GameState, move: SplitCandidateMove): GameState => {
  const newLine = {
    ...move.line,
    color: state.currentPlayer,
  }
  const nextLines = [...state.lines, newLine]
  const nextAreas = state.areas.flatMap((area) =>
    area.id === move.area.id ? move.splitResult.areas : [area],
  )

  return {
    ...state,
    lines: nextLines,
    areas: nextAreas,
    currentPlayer: state.currentPlayer === 'player1' ? 'player2' : 'player1',
    turnCount: state.turnCount + 1,
    pendingAreaChoice: null,
  }
}

describe('getBestBotV2Move', () => {
  it('returns a legal move after a new game and the human opening split (bot is player2)', () => {
    const initial = createInitialGameState()
    expect(initial.currentPlayer).toBe('player1')

    const humanCandidates = generateCandidateMoves(initial, 'player1')
    const humanSplit = humanCandidates.find(
      (candidate): candidate is SplitCandidateMove =>
        candidate.kind === 'split' && !candidate.isScoringMove,
    )

    expect(humanSplit, 'expected at least one non-scoring split for the opening position').toBeDefined()

    const afterHuman = applyNonScoringSplit(initial, humanSplit!)
    expect(afterHuman.currentPlayer).toBe('player2')
    expect(afterHuman.winner).toBeNull()

    const botMove = getBestBotV2Move(afterHuman, 'player2')

    expect(botMove, 'Bot V2 should produce a move on the second ply of a fresh game').not.toBeNull()
    expect(botMove!.move.kind === 'fill' || botMove!.move.kind === 'split').toBe(true)
  })
})
