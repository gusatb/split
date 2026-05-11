import { GameCanvas } from './GameCanvas'
import { useGameState } from './useGameState'
import './App.css'

function App() {
  const { board, lines } = useGameState()

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

        <GameCanvas board={board} lines={lines} />
      </section>
    </main>
  )
}

export default App
