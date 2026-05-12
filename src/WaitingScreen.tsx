import { useEffect } from 'react'
import { getSupabaseClient } from './lib/supabase'
import type { OnlineGameSession } from './onlineGames'
import type { GameRow } from './types/supabase'

interface WaitingScreenProps {
  session: OnlineGameSession
  onPlaying: (session: OnlineGameSession) => void
  onCancel: () => void
}

const toSession = (row: GameRow, fallback: OnlineGameSession): OnlineGameSession => ({
  id: row.id,
  shortCode: row.short_code,
  initialState: (row.state as unknown as OnlineGameSession['initialState'] | null) ?? fallback.initialState,
})

export function WaitingScreen({ session, onPlaying, onCancel }: WaitingScreenProps) {
  useEffect(() => {
    const client = getSupabaseClient()
    const channel = client
      .channel(`game-waiting:${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          const game = payload.new as GameRow

          if (game.status === 'playing') {
            onPlaying(toSession(game, session))
          }
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [onPlaying, session])

  return (
    <main className="landing-shell">
      <section className="landing-card waiting-card" aria-labelledby="waiting-title">
        <p className="eyebrow">Online game</p>
        <h1 id="waiting-title">Waiting for opponent</h1>
        <p className="landing-copy">Share this code with another player:</p>
        <div className="room-code" aria-label={`Game code ${session.shortCode}`}>
          {session.shortCode}
        </div>
        <p className="landing-copy">The game starts automatically when they join.</p>
        <button type="button" className="game-button secondary" onClick={onCancel}>
          Back to menu
        </button>
      </section>
    </main>
  )
}
