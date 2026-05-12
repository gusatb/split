import { useState } from 'react'
import { isSupabaseConfigured } from './lib/supabase'

interface LandingPageProps {
  onLocalPlay: () => void
  onPlayBot: () => void
  onStartOnlineGame: () => void
  onJoinOnlineGame: (shortCode: string) => void
  isOnlineBusy: boolean
  onlineError: string | null
}

export function LandingPage({
  onLocalPlay,
  onPlayBot,
  onStartOnlineGame,
  onJoinOnlineGame,
  isOnlineBusy,
  onlineError,
}: LandingPageProps) {
  const [joinCode, setJoinCode] = useState('')

  return (
    <main className="landing-shell">
      <section className="landing-card" aria-labelledby="landing-title">
        <p className="eyebrow">Split</p>
        <h1 id="landing-title">Draw the board apart.</h1>
        <p className="landing-copy">
          Play locally on one device or host an online match with a four-character room code.
        </p>

        <div className="landing-actions">
          <button type="button" className="game-button primary" onClick={onLocalPlay}>
            Local Play
          </button>
          <button type="button" className="game-button" onClick={onPlayBot}>
            Play vs Bot
          </button>
          <button
            type="button"
            className="game-button"
            onClick={onStartOnlineGame}
            disabled={!isSupabaseConfigured || isOnlineBusy}
          >
            {isOnlineBusy ? 'Starting...' : 'Start Online Game'}
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
            <span className="label">Join Online Game</span>
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
              className="game-button secondary"
              disabled={!isSupabaseConfigured || isOnlineBusy || joinCode.length !== 4}
            >
              Join
            </button>
          </div>
        </form>

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
