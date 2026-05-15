import { useState } from 'react'
import { isSupabaseConfigured } from './lib/supabase'
import type { LocalSeatConfig, LocalSeatKind } from './localSeats'
import { defaultLocalSeatConfig } from './localSeats'

type LandingPanel = 'main' | 'local-game' | 'online'

interface LandingPageProps {
  resumeAvailable: boolean
  onContinueGame: () => void
  onStartLocalGame: (config: LocalSeatConfig) => void
  onStartOnlineGame: () => void
  onJoinOnlineGame: (shortCode: string) => void
  isOnlineBusy: boolean
  onlineError: string | null
}

const SEAT_OPTIONS: { value: LocalSeatKind; label: string }[] = [
  { value: 'human', label: 'Human' },
  { value: 'bot-v1', label: 'Bot V1' },
  { value: 'bot-v2', label: 'Bot V2' },
]

export function LandingPage({
  resumeAvailable,
  onContinueGame,
  onStartLocalGame,
  onStartOnlineGame,
  onJoinOnlineGame,
  isOnlineBusy,
  onlineError,
}: LandingPageProps) {
  const [panel, setPanel] = useState<LandingPanel>('main')
  const [joinCode, setJoinCode] = useState('')
  const [localSeats, setLocalSeats] = useState<LocalSeatConfig>(() => defaultLocalSeatConfig())

  return (
    <main className="landing-shell">
      <section className="landing-card" aria-labelledby="landing-title">
        <p className="eyebrow">Split</p>
        <h1 id="landing-title">Draw the board apart.</h1>
        <p className="landing-copy">
          Continue a saved game, start a local session on this device, or play online with a
          four-letter room code.
        </p>

        {panel === 'main' ? (
          <div className="landing-menu-panel">
            {resumeAvailable ? (
              <div className="landing-continue-block">
                <button type="button" className="game-button primary" onClick={onContinueGame}>
                  Continue game
                </button>
                <p className="landing-continue-hint">Resume your saved local game</p>
              </div>
            ) : null}

            <div className="landing-actions landing-actions--stack">
              <button type="button" className="game-button" onClick={() => setPanel('local-game')}>
                Local game
              </button>
              <button type="button" className="game-button" onClick={() => setPanel('online')}>
                Play online
              </button>
            </div>
          </div>
        ) : null}

        {panel === 'local-game' ? (
          <div className="landing-menu-panel">
            <div className="landing-back-row">
              <button
                type="button"
                className="game-button secondary landing-back-button"
                onClick={() => setPanel('main')}
              >
                Back
              </button>
            </div>
            <h2 className="landing-menu-heading">Local game</h2>
            <p className="landing-local-intro">Choose who controls each side on this device.</p>

            <div className="landing-seat-grid">
              <label className="landing-seat-field">
                <span className="label">Player 1</span>
                <select
                  value={localSeats.player1}
                  onChange={(event) =>
                    setLocalSeats((prev) => ({
                      ...prev,
                      player1: event.target.value as LocalSeatKind,
                    }))
                  }
                >
                  {SEAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="landing-seat-field">
                <span className="label">Player 2</span>
                <select
                  value={localSeats.player2}
                  onChange={(event) =>
                    setLocalSeats((prev) => ({
                      ...prev,
                      player2: event.target.value as LocalSeatKind,
                    }))
                  }
                >
                  {SEAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="landing-actions landing-actions--stack">
              <button
                type="button"
                className="game-button primary"
                onClick={() => onStartLocalGame(localSeats)}
              >
                Start game
              </button>
            </div>
          </div>
        ) : null}

        {panel === 'online' ? (
          <div className="landing-menu-panel">
            <div className="landing-back-row">
              <button
                type="button"
                className="game-button secondary landing-back-button"
                onClick={() => setPanel('main')}
              >
                Back
              </button>
            </div>
            <h2 className="landing-menu-heading">Play online</h2>
            <div className="landing-actions landing-actions--stack">
              <button
                type="button"
                className="game-button primary"
                onClick={onStartOnlineGame}
                disabled={!isSupabaseConfigured || isOnlineBusy}
              >
                {isOnlineBusy ? 'Starting…' : 'Create game'}
              </button>
            </div>

            <form
              className="join-form"
              onSubmit={(event) => {
                event.preventDefault()
                onJoinOnlineGame(joinCode)
              }}
            >
              <label htmlFor="join-code">
                <span className="label">Join game</span>
              </label>
              <div className="join-controls">
                <input
                  id="join-code"
                  value={joinCode}
                  maxLength={4}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="CODE"
                  onChange={(event) =>
                    setJoinCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())
                  }
                />
                <button
                  type="submit"
                  className="game-button"
                  disabled={!isSupabaseConfigured || isOnlineBusy || joinCode.length !== 4}
                >
                  Join game
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {!isSupabaseConfigured ? (
          <p className="online-error">
            Online play needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </p>
        ) : null}
        {onlineError ? <p className="online-error">{onlineError}</p> : null}
      </section>
    </main>
  )
}
