import { useEffect, useState } from 'react'
import { GameCanvas } from './GameCanvas'
import { LandingPage } from './LandingPage'
import {
  checkOnlineGameSetup,
  createOnlineGame,
  getOnlineErrorMessage,
  joinOnlineGame,
  type OnlineGameSession,
} from './onlineGames'
import { isSupabaseConfigured } from './lib/supabase'
import { themes, type ThemeId } from './themes'
import { getAreaPolygonPoints, useGameState } from './useGameState'
import { WaitingScreen } from './WaitingScreen'
import type { AreaInspectionSnapshot, PlayerColor } from './types'
import './App.css'

type View = 'home' | 'waiting' | 'game'

interface GameViewProps {
  onlineSession: OnlineGameSession | null
  themeId: ThemeId
  onThemeChange: (themeId: ThemeId) => void
}

function GameView({ onlineSession, themeId, onThemeChange }: GameViewProps) {
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
  } = useGameState(
    onlineSession
      ? {
          gameId: onlineSession.id,
          initialState: onlineSession.initialState,
        }
      : undefined,
  )
  const [isInspectingAreas, setIsInspectingAreas] = useState(false)
  const [inspectionAreas, setInspectionAreas] = useState<AreaInspectionSnapshot[]>([])
  const [inspectedArea, setInspectedArea] = useState<AreaInspectionSnapshot | null>(null)
  const activeTheme = themes[themeId]
  const localPlayer = onlineSession?.localPlayer ?? null
  const isLocalTurn = !localPlayer || currentPlayer === localPlayer
  const canApplyPieRule = isLocalTurn && turnCount === 1 && !winner && !pendingAreaChoice
  const turnLabel = winner
    ? `${winner} wins`
    : canApplyPieRule
      ? 'Player 2 color choice'
      : currentPlayer
  const getPlayerLabel = (player: PlayerColor) =>
    `${player === 'player1' ? 'Player 1' : 'Player 2'}${localPlayer === player ? ' (You)' : ''}`
  const prompt = (() => {
    if (isInspectingAreas) {
      return 'Inspection mode: move over the board to inspect the area under the indicator.'
    }

    if (winner) {
      return `${winner} surpassed 50 points. Start a new pass-and-play session to play again.`
    }

    if (pendingAreaChoice) {
      if (!isLocalTurn) {
        return 'Waiting for opponent.'
      }

      return `It's your turn: choose which highlighted sub-area scores for ${pendingAreaChoice.scoringPlayer}.`
    }

    if (!isLocalTurn) {
      return 'Waiting for opponent.'
    }

    if (turnCount === 0) {
      return "It's your turn: draw the first line between two existing edges."
    }

    if (canApplyPieRule) {
      return "It's your turn: choose which color to play as. Swap colors now, or keep Player 2 by drawing the next move."
    }

    return "It's your turn: draw a split between two legal snapped edge points, or tap a neutral area worth 5 or less to fill it."
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
            <span className="label">{getPlayerLabel('player1')}</span>
            <strong>{playerScores.player1.toFixed(1)}</strong>
          </div>
          <div>
            <span className="label">{getPlayerLabel('player2')}</span>
            <strong>{playerScores.player2.toFixed(1)}</strong>
          </div>
          <label className="appearance-control">
            <span className="label">Appearance</span>
            <select
              value={themeId}
              onChange={(event) => onThemeChange(event.target.value as ThemeId)}
            >
              <option value="synth">{themes.synth.label}</option>
              <option value="tactile">{themes.tactile.label}</option>
            </select>
          </label>
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
          theme={activeTheme}
          board={board}
          lines={lines}
          areas={areas}
          currentPlayer={currentPlayer}
          pendingAreaChoice={pendingAreaChoice}
          inspectionMode={isInspectingAreas}
          inspectionAreas={inspectionAreas}
          inspectedAreaId={inspectedArea?.id ?? null}
          interactionDisabled={!isLocalTurn}
          onDrawLine={actions.drawLine}
          onFillArea={actions.fillAreaAt}
          onChoosePendingArea={actions.choosePendingArea}
          onInspectAreaChange={setInspectedArea}
        />
      </section>
    </main>
  )
}

function App() {
  const [view, setView] = useState<View>('home')
  const [onlineSession, setOnlineSession] = useState<OnlineGameSession | null>(null)
  const [themeId, setThemeId] = useState<ThemeId>('synth')
  const [isOnlineBusy, setIsOnlineBusy] = useState(false)
  const [onlineError, setOnlineError] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = themeId
  }, [themeId])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return
    }

    let isMounted = true

    checkOnlineGameSetup()
      .then(() => {
        if (isMounted) {
          setOnlineError(null)
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setOnlineError(getOnlineErrorMessage(error, 'Online play is not ready.'))
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const startLocalPlay = () => {
    setOnlineSession(null)
    setOnlineError(null)
    setView('game')
  }

  const startOnlineGame = async () => {
    setIsOnlineBusy(true)
    setOnlineError(null)

    try {
      const session = await createOnlineGame()
      setOnlineSession(session)
      setView('waiting')
    } catch (error) {
      console.error('Failed to start online game', error)
      setOnlineError(getOnlineErrorMessage(error, 'Failed to start online game.'))
    } finally {
      setIsOnlineBusy(false)
    }
  }

  const joinOnlineGameByCode = async (shortCode: string) => {
    setIsOnlineBusy(true)
    setOnlineError(null)

    try {
      const session = await joinOnlineGame(shortCode)
      setOnlineSession(session)
      setView('game')
    } catch (error) {
      console.error('Failed to join online game', error)
      setOnlineError(getOnlineErrorMessage(error, 'Failed to join online game.'))
    } finally {
      setIsOnlineBusy(false)
    }
  }

  if (view === 'waiting' && onlineSession) {
    return (
      <WaitingScreen
        session={onlineSession}
        onPlaying={(session) => {
          setOnlineSession(session)
          setView('game')
        }}
        onCancel={() => {
          setOnlineSession(null)
          setView('home')
        }}
      />
    )
  }

  if (view === 'game') {
    return (
      <GameView
        key={onlineSession?.id ?? 'local'}
        onlineSession={onlineSession}
        themeId={themeId}
        onThemeChange={setThemeId}
      />
    )
  }

  return (
    <LandingPage
      onLocalPlay={startLocalPlay}
      onStartOnlineGame={startOnlineGame}
      onJoinOnlineGame={joinOnlineGameByCode}
      isOnlineBusy={isOnlineBusy}
      onlineError={onlineError}
    />
  )
}

export default App
