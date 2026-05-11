import { GameCanvas } from './GameCanvas'
import { useGameState } from './useGameState'
import './App.css'

function App() {
  const {
    actions,
    areas,
    board,
    currentPlayer,
    lines,
    pendingAreaChoice,
    playerScores,
    turnCount,
    winner,
  } = useGameState()
  const canApplyPieRule = turnCount === 1 && !winner && !pendingAreaChoice
  const turnLabel = winner
    ? `${winner} wins`
    : canApplyPieRule
      ? 'Player 2 color choice'
      : currentPlayer
  const prompt = (() => {
    if (winner) {
      return `${winner} surpassed 50 points. Start a new pass-and-play session to play again.`
    }

    if (pendingAreaChoice) {
      return `${pendingAreaChoice.choosingPlayer} must choose which highlighted sub-area scores for ${pendingAreaChoice.scoringPlayer}.`
    }

    if (turnCount === 0) {
      return 'Turn 1: Player 1 draws the first line between two existing edges.'
    }

    if (canApplyPieRule) {
      return 'Turn 2: Player 2 chooses which color to play as. Swap colors now, or keep Player 2 by drawing the next move.'
    }

    return 'Draw a split between two legal snapped edge points, or tap a neutral area worth 5 or less to fill it.'
  })()

  return (
    <main className="app-shell">
      {winner ? <div className="victory-banner">{winner} wins!</div> : null}

      <section className="game-panel" aria-labelledby="game-title">
        <div className="game-header">
          <p className="eyebrow">Split</p>
          <h1 id="game-title">Game board</h1>
          <p>
            A {board.boardUnits}x{board.boardUnits} logic grid is mapped to a{' '}
            {board.canvasSize}x{board.canvasSize} pixel canvas.
          </p>
        </div>

        <div className="game-status" aria-live="polite">
          <div>
            <span className="label">Turn</span>
            <strong>{turnLabel}</strong>
          </div>
          <div>
            <span className="label">Player 1</span>
            <strong>{playerScores.player1.toFixed(1)}</strong>
          </div>
          <div>
            <span className="label">Player 2</span>
            <strong>{playerScores.player2.toFixed(1)}</strong>
          </div>
        </div>

        <p className="prompt">{prompt}</p>

        <div className="game-actions">
          {canApplyPieRule ? (
            <button type="button" className="game-button" onClick={actions.applyPieRule}>
              Swap colors
            </button>
          ) : null}
          <button type="button" className="game-button secondary" onClick={actions.resetGame}>
            Reset local game
          </button>
        </div>

        <GameCanvas
          board={board}
          lines={lines}
          areas={areas}
          currentPlayer={currentPlayer}
          pendingAreaChoice={pendingAreaChoice}
          onDrawLine={actions.drawLine}
          onFillArea={actions.fillAreaAt}
          onChoosePendingArea={actions.choosePendingArea}
        />
      </section>
    </main>
  )
}

export default App
