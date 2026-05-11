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

  return (
    <main className="app-shell">
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
            <strong>{winner ? `${winner} wins` : currentPlayer}</strong>
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

        {pendingAreaChoice ? (
          <p className="prompt">
            {pendingAreaChoice.choosingPlayer} must choose which highlighted sub-area scores for{' '}
            {pendingAreaChoice.scoringPlayer}.
          </p>
        ) : (
          <p className="prompt">
            Click a line edge to start a split, then click another edge to finish it. Click inside a
            neutral area of size 5 or less to fill it.
          </p>
        )}

        {canApplyPieRule ? (
          <button type="button" className="pie-rule-button" onClick={actions.applyPieRule}>
            Apply pie rule: swap colors
          </button>
        ) : null}

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
