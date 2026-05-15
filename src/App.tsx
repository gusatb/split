import { useEffect, useMemo, useState } from 'react'
import { getBestBotMove, getDefenseChoiceForPlayer } from './BotPlayer'
import { getBestBotV2Move } from './BotPlayerV2'
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
import {
  defaultGameId,
  hasInProgressLocalSave,
  localStorageAdapter,
  migrateInProgressSaveToDefaultSlot,
  setLastLocalGameMode,
  getLastLocalGameMode,
} from './storage'
import {
  defaultLocalSeatConfig,
  getSeatForPlayer,
  loadLocalSeatConfig,
  saveLocalSeatConfig,
  type LocalSeatConfig,
} from './localSeats'
import { themes, type ThemeId } from './themes'
import { getAreaPolygonPoints, useGameState, type GameState } from './useGameState'
import { WaitingScreen } from './WaitingScreen'
import type { AreaInspectionSnapshot, PlayerColor } from './types'
import './App.css'

type View = 'home' | 'waiting' | 'game'
type GameMode = 'local' | 'online'

const inferSeatConfigForContinue = (): LocalSeatConfig => {
  const saved = loadLocalSeatConfig()

  if (saved) {
    return saved
  }

  const last = getLastLocalGameMode()

  if (last === 'bot-v1') {
    return { player1: 'human', player2: 'bot-v1' }
  }

  if (last === 'bot-v2') {
    return { player1: 'human', player2: 'bot-v2' }
  }

  return defaultLocalSeatConfig()
}

const playerDisplayName = (player: PlayerColor) =>
  player === 'player1' ? 'Player 1' : 'Player 2'

interface GameViewProps {
  onlineSession: OnlineGameSession | null
  mode: GameMode
  localSeatConfig: LocalSeatConfig | null
  themeId: ThemeId
  onThemeChange: (themeId: ThemeId) => void
}

const getAreaCentroid = (area: AreaInspectionSnapshot) => {
  const pointTotal = area.polygon.reduce(
    (total, point) => ({
      x: total.x + point.x,
      y: total.y + point.y,
    }),
    { x: 0, y: 0 },
  )

  return {
    x: pointTotal.x / area.polygon.length,
    y: pointTotal.y / area.polygon.length,
  }
}

function GameView({ onlineSession, mode, localSeatConfig, themeId, onThemeChange }: GameViewProps) {
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
  const [showAreas, setShowAreas] = useState(false)
  const inspectionAreas = useMemo(
    () =>
      areas.map((area) => ({
        id: area.id,
        color: area.color,
        geometricArea: area.geometricArea,
        polygon: getAreaPolygonPoints(area, lines),
      })),
    [areas, lines],
  )
  const [inspectedArea, setInspectedArea] = useState<AreaInspectionSnapshot | null>(null)
  const activeTheme = themes[themeId]
  const localPlayer = onlineSession?.localPlayer ?? null

  const canInteractWithBoard =
    mode === 'online' && onlineSession
      ? !onlineSession.localPlayer || currentPlayer === onlineSession.localPlayer
      : mode === 'local' && localSeatConfig
        ? pendingAreaChoice
          ? getSeatForPlayer(localSeatConfig, pendingAreaChoice.choosingPlayer) === 'human'
          : getSeatForPlayer(localSeatConfig, currentPlayer) === 'human'
        : true
  const gameState = useMemo<GameState>(
    () => ({
      board,
      lines,
      areas,
      currentPlayer,
      turnCount,
      playerScores,
      winner,
      pendingAreaChoice,
    }),
    [areas, board, currentPlayer, lines, pendingAreaChoice, playerScores, turnCount, winner],
  )
  const canApplyPieRule = canInteractWithBoard && turnCount === 1 && !winner && !pendingAreaChoice
  const turnAnnouncement = winner
    ? `${playerDisplayName(winner)} won the game.`
    : canApplyPieRule
      ? 'Player 2 chooses a color (pie rule).'
      : mode === 'local' && localSeatConfig
        ? (() => {
            const seat = getSeatForPlayer(localSeatConfig, currentPlayer)

            if (seat === 'human') {
              return `${playerDisplayName(currentPlayer)}'s turn.`
            }

            return `${seat === 'bot-v1' ? 'Bot V1' : 'Bot V2'} (${playerDisplayName(currentPlayer)}) is playing.`
          })()
        : `${playerDisplayName(currentPlayer)}'s turn.`
  const seatSuffix = (player: PlayerColor) => {
    if (mode !== 'local' || !localSeatConfig) {
      return ''
    }

    const k = getSeatForPlayer(localSeatConfig, player)

    if (k === 'bot-v1') {
      return ' (Bot V1)'
    }

    if (k === 'bot-v2') {
      return ' (Bot V2)'
    }

    return ''
  }
  const getPlayerLabel = (player: PlayerColor) =>
    `${playerDisplayName(player)}${localPlayer === player ? ' (You)' : ''}${seatSuffix(player)}`
  const prompt = (() => {
    if (showAreas) {
      return 'Show areas is on: area scores are shown on the board. You can still play normally.'
    }

    if (winner) {
      return `${playerDisplayName(winner)} surpassed 50 points. Return home to start a new local game.`
    }

    if (pendingAreaChoice) {
      if (!canInteractWithBoard) {
        const chooser = pendingAreaChoice.choosingPlayer

        if (mode === 'local' && localSeatConfig) {
          const seat = getSeatForPlayer(localSeatConfig, chooser)

          if (seat !== 'human') {
            return `${seat === 'bot-v1' ? 'Bot V1' : 'Bot V2'} is choosing which score to give.`
          }
        }

        return 'Waiting for opponent.'
      }

      return `It's your turn: choose which highlighted sub-area scores for ${playerDisplayName(pendingAreaChoice.scoringPlayer)}.`
    }

    if (!canInteractWithBoard) {
      if (mode === 'local' && localSeatConfig) {
        const seat = getSeatForPlayer(localSeatConfig, currentPlayer)

        if (seat !== 'human') {
          return `${seat === 'bot-v1' ? 'Bot V1' : 'Bot V2'} is thinking…`
        }
      }

      return 'Waiting for opponent.'
    }

    if (turnCount === 0) {
      return "It's your turn: draw the first line between two existing edges."
    }

    if (canApplyPieRule) {
      return "It's your turn: choose which color to play as. Swap colors now, or keep Player 2 by drawing the next move."
    }

    return "It's your turn: draw a split between two legal snapped edge points, or tap a neutral area under 5 points to fill it in one tap."
  })()
  const exitShowAreas = () => {
    setShowAreas(false)
    setInspectedArea(null)
  }
  const resetLocalGame = () => {
    exitShowAreas()
    actions.resetGame()
  }

  useEffect(() => {
    if (winner || mode === 'online' || !localSeatConfig) {
      return
    }

    if (pendingAreaChoice) {
      const chooser = pendingAreaChoice.choosingPlayer
      const chooserSeat = getSeatForPlayer(localSeatConfig, chooser)

      if (chooserSeat === 'human') {
        return
      }

      const [areaAId, areaBId] = pendingAreaChoice.areaIds
      const areaA = areas.find((area) => area.id === areaAId)
      const areaB = areas.find((area) => area.id === areaBId)

      if (!areaA || !areaB) {
        return
      }

      const timeoutId = window.setTimeout(() => {
        const defenseChoice = getDefenseChoiceForPlayer(
          areaA,
          areaB,
          pendingAreaChoice.scoringPlayer,
          lines,
        )

        actions.choosePendingArea(defenseChoice.chosenForOpponent.id)
      }, 500)

      return () => window.clearTimeout(timeoutId)
    }

    const moverSeat = getSeatForPlayer(localSeatConfig, currentPlayer)

    if (moverSeat === 'human') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      const evaluatedMove =
        moverSeat === 'bot-v2'
          ? getBestBotV2Move(gameState, currentPlayer)
          : getBestBotMove(gameState, currentPlayer)

      if (!evaluatedMove) {
        return
      }

      if (evaluatedMove.move.kind === 'fill') {
        actions.fillAreaAt(
          getAreaCentroid({
            id: evaluatedMove.move.area.id,
            color: evaluatedMove.move.area.color,
            geometricArea: evaluatedMove.move.area.geometricArea,
            polygon: getAreaPolygonPoints(evaluatedMove.move.area, lines),
          }),
        )
        return
      }

      actions.drawLine(
        {
          point: evaluatedMove.move.start.point,
          lineId: evaluatedMove.move.start.lineId,
        },
        {
          point: evaluatedMove.move.end.point,
          lineId: evaluatedMove.move.end.lineId,
        },
      )
    }, 650)

    return () => window.clearTimeout(timeoutId)
  }, [
    actions,
    areas,
    currentPlayer,
    gameState,
    lines,
    localSeatConfig,
    mode,
    pendingAreaChoice,
    winner,
  ])

  return (
    <main className="app-shell">
      {winner ? (
        <div className="victory-banner">{playerDisplayName(winner)} wins!</div>
      ) : null}

      <section className="game-panel" aria-labelledby="game-title">
        <div className="game-header">
          <p className="eyebrow">Split</p>
          <h1 id="game-title">Game board</h1>
        </div>

        <GameCanvas
          theme={activeTheme}
          board={board}
          lines={lines}
          areas={areas}
          currentPlayer={currentPlayer}
          pendingAreaChoice={pendingAreaChoice}
          showAreas={showAreas}
          inspectionAreas={inspectionAreas}
          inspectedAreaId={inspectedArea?.id ?? null}
          interactionDisabled={!canInteractWithBoard}
          onDrawLine={actions.drawLine}
          onFillArea={actions.fillAreaAt}
          onChoosePendingArea={actions.choosePendingArea}
          onInspectAreaChange={setInspectedArea}
        />

        {pendingAreaChoice && canInteractWithBoard ? (
          <div
            className="pending-area-choice-bar"
            role="group"
            aria-label="Choose which score to give your opponent"
          >
            {pendingAreaChoice.areaIds.map((areaId) => {
              const area = areas.find((candidate) => candidate.id === areaId)

              if (!area) {
                return null
              }

              const scoreText = area.geometricArea.toFixed(1)

              return (
                <button
                  key={areaId}
                  type="button"
                  className="game-button primary pending-area-choice-button"
                  onClick={() => actions.choosePendingArea(areaId)}
                >
                  {`Give ${scoreText}`}
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="player-scores-row" aria-live="polite" aria-atomic="true">
          <span className="visually-hidden">{turnAnnouncement}</span>
          <div
            className={`player-score-box${!winner && currentPlayer === 'player1' ? ' player-score-box--active-turn' : ''}${winner === 'player1' ? ' player-score-box--winner' : ''}`}
          >
            <span className="label">{getPlayerLabel('player1')}</span>
            <strong className="player-score-value">{playerScores.player1.toFixed(1)}</strong>
          </div>
          <div
            className={`player-score-box${!winner && currentPlayer === 'player2' ? ' player-score-box--active-turn' : ''}${winner === 'player2' ? ' player-score-box--winner' : ''}`}
          >
            <span className="label">{getPlayerLabel('player2')}</span>
            <strong className="player-score-value">{playerScores.player2.toFixed(1)}</strong>
          </div>
        </div>

        <div className="game-actions game-actions--under-board">
          {canApplyPieRule ? (
            <button type="button" className="game-button secondary" onClick={actions.applyPieRule}>
              Swap colors
            </button>
          ) : null}
          <label className="show-areas-control">
            <input
              type="checkbox"
              checked={showAreas}
              onChange={(event) => {
                if (event.target.checked) {
                  setShowAreas(true)
                } else {
                  exitShowAreas()
                }
              }}
            />
            <span>Show areas</span>
          </label>
        </div>

        <div className="game-below-board">
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

          <p className="prompt">{prompt}</p>

          {showAreas ? (
            <div className="inspection-readout" aria-live="polite">
              <span className="label">Area under cursor</span>
              <strong>{inspectedArea ? inspectedArea.geometricArea.toFixed(2) : 'None'}</strong>
            </div>
          ) : null}
        </div>

        <div className="game-footer-reset">
          <button type="button" className="game-button game-button--ghost" onClick={resetLocalGame}>
            Reset local game
          </button>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [view, setView] = useState<View>('home')
  const [gameMode, setGameMode] = useState<GameMode>('local')
  const [onlineSession, setOnlineSession] = useState<OnlineGameSession | null>(null)
  const [localSeatConfig, setLocalSeatConfig] = useState<LocalSeatConfig>(() => defaultLocalSeatConfig())
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

  const resumeAvailable = useMemo(
    () => (view === 'home' ? hasInProgressLocalSave() : false),
    [view],
  )

  const continueGame = () => {
    if (!hasInProgressLocalSave()) {
      return
    }

    migrateInProgressSaveToDefaultSlot()
    const seats = inferSeatConfigForContinue()
    saveLocalSeatConfig(seats)
    setLocalSeatConfig(seats)
    setLastLocalGameMode('local')
    setGameMode('local')
    setOnlineSession(null)
    setOnlineError(null)
    setView('game')
  }

  const startLocalGame = (config: LocalSeatConfig) => {
    localStorageAdapter.clearGameState(defaultGameId)
    saveLocalSeatConfig(config)
    setLocalSeatConfig(config)
    setLastLocalGameMode('local')
    setGameMode('local')
    setOnlineSession(null)
    setOnlineError(null)
    setView('game')
  }

  const startOnlineGame = async () => {
    setIsOnlineBusy(true)
    setOnlineError(null)

    try {
      const session = await createOnlineGame()
      setGameMode('online')
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
      setGameMode('online')
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
        mode={gameMode}
        localSeatConfig={gameMode === 'local' ? localSeatConfig : null}
        themeId={themeId}
        onThemeChange={setThemeId}
      />
    )
  }

  return (
    <LandingPage
      resumeAvailable={resumeAvailable}
      onContinueGame={continueGame}
      onStartLocalGame={startLocalGame}
      onStartOnlineGame={startOnlineGame}
      onJoinOnlineGame={joinOnlineGameByCode}
      isOnlineBusy={isOnlineBusy}
      onlineError={onlineError}
    />
  )
}

export default App
