import { useState } from 'react'
import { GameCanvas } from './GameCanvas'
import { getAreaPolygonPoints, useGameState } from './useGameState'
import type { AreaInspectionSnapshot } from './types'
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
  const [isInspectingAreas, setIsInspectingAreas] = useState(false)
  const [inspectionAreas, setInspectionAreas] = useState<AreaInspectionSnapshot[]>([])
  const [inspectedArea, setInspectedArea] = useState<AreaInspectionSnapshot | null>(null)
  const canApplyPieRule = turnCount === 1 && !winner && !pendingAreaChoice
  const turnLabel = winner
    ? `${winner} wins`
    : canApplyPieRule
      ? 'Player 2 color choice'
      : currentPlayer
  const prompt = (() => {
    if (isInspectingAreas) {
      return 'Inspection mode: move over the board to inspect the area under the indicator.'
    }

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
  const enterInspectionMode = () => {
    setInspectionAreas(
      areas.map((area) => ({
        id: area.id,
        color: area.color,
        geometricArea: area.geometricArea,
        polygon: getAreaPolygonPoints(area, lines),
      })),
    )
    setInspectedArea(null)
    setIsInspectingAreas(true)
  }
  const exitInspectionMode = () => {
    setIsInspectingAreas(false)
    setInspectionAreas([])
    setInspectedArea(null)
  }
  const resetLocalGame = () => {
    exitInspectionMode()
    actions.resetGame()
  }

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

        {isInspectingAreas ? (
          <div className="inspection-readout" aria-live="polite">
            <span className="label">Inspected area</span>
            <strong>{inspectedArea ? inspectedArea.geometricArea.toFixed(2) : 'None'}</strong>
          </div>
        ) : null}

        <div className="game-actions">
          {canApplyPieRule ? (
            <button type="button" className="game-button" onClick={actions.applyPieRule}>
              Swap colors
            </button>
          ) : null}
          <button
            type="button"
            className="game-button"
            onClick={isInspectingAreas ? exitInspectionMode : enterInspectionMode}
          >
            {isInspectingAreas ? 'Exit inspection mode' : 'Inspect areas'}
          </button>
          <button type="button" className="game-button secondary" onClick={resetLocalGame}>
            Reset local game
          </button>
        </div>

        <GameCanvas
          key={isInspectingAreas ? 'inspection-canvas' : 'game-canvas'}
          board={board}
          lines={lines}
          areas={areas}
          currentPlayer={currentPlayer}
          pendingAreaChoice={pendingAreaChoice}
          inspectionMode={isInspectingAreas}
          inspectionAreas={inspectionAreas}
          inspectedAreaId={inspectedArea?.id ?? null}
          onDrawLine={actions.drawLine}
          onFillArea={actions.fillAreaAt}
          onChoosePendingArea={actions.choosePendingArea}
          onInspectAreaChange={setInspectedArea}
        />
      </section>
    </main>
  )
}

export default App
