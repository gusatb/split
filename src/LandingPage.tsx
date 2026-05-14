import { useState } from 'react'
import { isSupabaseConfigured } from './lib/supabase'
import type { LocalSavedGameMode } from './storage'

type LandingPanel = 'main' | 'new-game' | 'online'

interface LandingPageProps {
  resumeMode: LocalSavedGameMode | null
  onContinueGame: () => void
  onNewPassAndPlay: () => void
  onNewBotGame: () => void
  onStartOnlineGame: () => void
  onJoinOnlineGame: (shortCode: string) => void
  isOnlineBusy: boolean
  onlineError: string | null
}

export function LandingPage({
  resumeMode,
  onContinueGame,
  onNewPassAndPlay,
  onNewBotGame,
  onStartOnlineGame,
  onJoinOnlineGame,
  isOnlineBusy,
  onlineError,
}: LandingPageProps) {
  const [panel, setPanel] = useState<LandingPanel>('main')
  const [joinCode, setJoinCode] = useState('')

  return (
    <main className="landing-shell">
      <section className="landing-card" aria-labelledby="landing-title">
        <p className="eyebrow">Split</p>
        <h1 id="landing-title">Draw the board apart.</h1>
        <p className="landing-copy">
          Continue a saved pass-and-play or bot game, start fresh on this device, or play online
          with a four-letter room code.
        </p>

        {panel === 'main' ? (
          <div className="landing-menu-panel">
            {resumeMode !== null ? (
              <div className="landing-continue-block">
                <button type="button" className="game-button primary" onClick={onContinueGame}>
                  Continue game
                </button>
                <p className="landing-continue-hint">
                  {resumeMode === 'bot' ? 'Resume vs bot' : 'Resume pass and play'}
                </p>
              </div>
            ) : null}

            <div className="landing-actions landing-actions--stack">
              <button type="button" className="game-button" onClick={() => setPanel('new-game')}>
                New game
              </button>
              <button type="button" className="game-button" onClick={() => setPanel('online')}>
                Play online
              </button>
            </div>
          </div>
        ) : null}

        {panel === 'new-game' ? (
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
            <h2 className="landing-menu-heading">New game</h2>
            <div className="landing-actions landing-actions--stack">
              <button type="button" className="game-button primary" onClick={onNewPassAndPlay}>
                Pass and play
              </button>
              <button type="button" className="game-button" onClick={onNewBotGame}>
                Play bot
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
