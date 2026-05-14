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
  BOT_V1_GAME_ID,
  BOT_V2_GAME_ID,
  LEGACY_BOT_GAME_ID,
  defaultGameId,
  getContinueLocalGameMode,
  localStorageAdapter,
  setLastLocalGameMode,
} from './storage'
import { themes, type ThemeId } from './themes'
import { getAreaPolygonPoints, useGameState, type GameState } from './useGameState'
import { WaitingScreen } from './WaitingScreen'
import type { AreaInspectionSnapshot, PlayerColor } from './types'
import './App.css'

type View = 'home' | 'waiting' | 'game'
type GameMode = 'local' | 'bot-v1' | 'bot-v2' | 'online'

const BOT_PLAYER: PlayerColor = 'player2'
const HUMAN_PLAYER: PlayerColor = 'player1'

const playerDisplayName = (player: PlayerColor) =>
  player === 'player1' ? 'Player 1' : 'Player 2'

interface GameViewProps {
  onlineSession: OnlineGameSession | null
  mode: GameMode
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

function GameView({ onlineSession, mode, themeId, onThemeChange }: GameViewProps) {
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
      : mode === 'bot-v1'
        ? {
            gameId: BOT_V1_GAME_ID,
            storageAdapter: localStorageAdapter,
          }
        : mode === 'bot-v2'
          ? {
              gameId: BOT_V2_GAME_ID,
              storageAdapter: localStorageAdapter,
            }
          : undefined,
  )
  const [isInspectingAreas, setIsInspectingAreas] = useState(false)
  const [inspectionAreas, setInspectionAreas] = useState<AreaInspectionSnapshot[]>([])
  const [inspectedArea, setInspectedArea] = useState<AreaInspectionSnapshot | null>(null)
  const activeTheme = themes[themeId]
  const localPlayer =
    onlineSession?.localPlayer ??
    (mode === 'bot-v1' || mode === 'bot-v2' ? HUMAN_PLAYER : null)
  const botPlayer = mode === 'bot-v1' || mode === 'bot-v2' ? BOT_PLAYER : null
  const isLocalTurn = !localPlayer || currentPlayer === localPlayer
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
  const canApplyPieRule = isLocalTurn && turnCount === 1 && !winner && !pendingAreaChoice
  const turnAnnouncement = winner
    ? `${playerDisplayName(winner)} won the game.`
    : canApplyPieRule
      ? 'Player 2 chooses a color (pie rule).'
      : `${playerDisplayName(currentPlayer)}'s turn.`
  const getPlayerLabel = (player: PlayerColor) =>
    `${playerDisplayName(player)}${localPlayer === player ? ' (You)' : ''}`
  const prompt = (() => {
    if (isInspectingAreas) {
      return 'Inspection mode: move over the board to inspect the area under the indicator.'
    }

    if (winner) {
      return `${playerDisplayName(winner)} surpassed 50 points. Start a new pass-and-play session to play again.`
    }

    if (pendingAreaChoice) {
      if (!isLocalTurn) {
        return 'Waiting for opponent.'
      }

      return `It's your turn: choose which highlighted sub-area scores for ${playerDisplayName(pendingAreaChoice.scoringPlayer)}.`
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

  useEffect(() => {
    if (!botPlayer || winner) {
      return
    }

    if (pendingAreaChoice?.choosingPlayer === botPlayer) {
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

    if (currentPlayer !== botPlayer || pendingAreaChoice) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      const evaluatedMove =
        mode === 'bot-v2'
          ? getBestBotV2Move(gameState, botPlayer)
          : getBestBotMove(gameState, botPlayer)

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
  }, [actions, areas, botPlayer, currentPlayer, gameState, lines, mode, pendingAreaChoice, winner])

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

        {pendingAreaChoice && isLocalTurn ? (
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
          <button
            type="button"
            className={isInspectingAreas ? 'game-button secondary' : 'game-button primary'}
            onClick={isInspectingAreas ? exitInspectionMode : enterInspectionMode}
          >
            {isInspectingAreas ? 'Exit inspection mode' : 'Inspect areas'}
          </button>
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

          {isInspectingAreas ? (
            <div className="inspection-readout" aria-live="polite">
              <span className="label">Inspected area</span>
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

  const resumeMode = useMemo(
    () => (view === 'home' ? getContinueLocalGameMode() : null),
    [view],
  )

  const continueGame = () => {
    const mode = getContinueLocalGameMode()

    if (!mode) {
      return
    }

    setLastLocalGameMode(mode)
    setGameMode(mode)
    setOnlineSession(null)
    setOnlineError(null)
    setView('game')
  }

  const startNewPassAndPlay = () => {
    localStorageAdapter.clearGameState(defaultGameId)
    setLastLocalGameMode('local')
    setGameMode('local')
    setOnlineSession(null)
    setOnlineError(null)
    setView('game')
  }

  const startNewBotV1Game = () => {
    localStorageAdapter.clearGameState(BOT_V1_GAME_ID)
    localStorageAdapter.clearGameState(LEGACY_BOT_GAME_ID)
    setLastLocalGameMode('bot-v1')
    setGameMode('bot-v1')
    setOnlineSession(null)
    setOnlineError(null)
    setView('game')
  }

  const startNewBotV2Game = () => {
    localStorageAdapter.clearGameState(BOT_V2_GAME_ID)
    setLastLocalGameMode('bot-v2')
    setGameMode('bot-v2')
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
        key={onlineSession?.id ?? gameMode}
        onlineSession={onlineSession}
        mode={gameMode}
        themeId={themeId}
        onThemeChange={setThemeId}
      />
    )
  }

  return (
    <LandingPage
      resumeMode={resumeMode}
      onContinueGame={continueGame}
      onNewPassAndPlay={startNewPassAndPlay}
      onNewBotV1Game={startNewBotV1Game}
      onNewBotV2Game={startNewBotV2Game}
      onStartOnlineGame={startOnlineGame}
      onJoinOnlineGame={joinOnlineGameByCode}
      isOnlineBusy={isOnlineBusy}
      onlineError={onlineError}
    />
  )
}

export default App
