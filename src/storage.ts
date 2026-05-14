import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabaseClient } from './lib/supabase'
import type { GameState } from './useGameState'
import type { Json } from './types/supabase'

const DEFAULT_GAME_ID = 'local-pass-and-play'
export const BOT_V1_GAME_ID = 'local-vs-bot-v1'
export const BOT_V2_GAME_ID = 'local-vs-bot-v2'
/** @deprecated Legacy key; reads merge into V1 for continue; clears with new V1 games */
export const LEGACY_BOT_GAME_ID = 'local-vs-bot'
const STORAGE_PREFIX = 'split-design:game-state:v1'
const LAST_LOCAL_MODE_KEY = 'split-design:last-local-mode:v1'

export type LocalSavedGameMode = 'local' | 'bot-v1' | 'bot-v2'

export interface StorageAdapter {
  saveGameState(state: GameState, gameId?: string): void | Promise<void>
  loadGameState(gameId: string): GameState | null | Promise<GameState | null>
  subscribeToGameState?(
    gameId: string,
    onStateChange: (state: GameState) => void,
  ): (() => void) | Promise<() => void>
}

const getStorageKey = (gameId: string) => `${STORAGE_PREFIX}:${gameId}`

const isBrowserStorageAvailable = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

export class LocalStorageAdapter implements StorageAdapter {
  saveGameState(state: GameState, gameId = DEFAULT_GAME_ID) {
    if (!isBrowserStorageAvailable()) {
      return
    }

    window.localStorage.setItem(getStorageKey(gameId), JSON.stringify(state))
  }

  loadGameState(gameId = DEFAULT_GAME_ID) {
    if (!isBrowserStorageAvailable()) {
      return null
    }

    const savedState = window.localStorage.getItem(getStorageKey(gameId))

    if (!savedState) {
      return null
    }

    try {
      return JSON.parse(savedState) as GameState
    } catch {
      window.localStorage.removeItem(getStorageKey(gameId))
      return null
    }
  }

  clearGameState(gameId = DEFAULT_GAME_ID) {
    if (!isBrowserStorageAvailable()) {
      return
    }

    window.localStorage.removeItem(getStorageKey(gameId))
  }
}

export class SupabaseAdapter implements StorageAdapter {
  async saveGameState(state: GameState, gameId?: string) {
    if (!gameId) {
      return
    }

    const { error } = await getSupabaseClient()
      .from('games')
      .update({ state: state as unknown as Json })
      .eq('id', gameId)

    if (error) {
      throw error
    }
  }

  async loadGameState(gameId: string) {
    const { data, error } = await getSupabaseClient()
      .from('games')
      .select('state')
      .eq('id', gameId)
      .maybeSingle()

    if (error) {
      throw error
    }

    return (data?.state as unknown as GameState | null) ?? null
  }

  subscribeToGameState(gameId: string, onStateChange: (state: GameState) => void) {
    const client = getSupabaseClient()
    let channel: RealtimeChannel | null = client
      .channel(`game-state:${gameId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`,
        },
        (payload) => {
          const nextState = payload.new.state as unknown as GameState | null

          if (nextState) {
            onStateChange(nextState)
          }
        },
      )
      .subscribe()

    return () => {
      if (channel) {
        void client.removeChannel(channel)
        channel = null
      }
    }
  }
}

export const defaultGameId = DEFAULT_GAME_ID
export const localStorageAdapter = new LocalStorageAdapter()
export const supabaseAdapter = new SupabaseAdapter()

export const isSavedGameInProgress = (state: GameState | null) => {
  if (!state) {
    return false
  }

  if (state.winner !== null) {
    return false
  }

  const isFreshStart =
    state.turnCount === 0 &&
    state.lines.length === 4 &&
    state.playerScores.player1 === 0 &&
    state.playerScores.player2 === 0 &&
    state.pendingAreaChoice === null

  return !isFreshStart
}

export const setLastLocalGameMode = (mode: LocalSavedGameMode) => {
  if (!isBrowserStorageAvailable()) {
    return
  }

  window.localStorage.setItem(LAST_LOCAL_MODE_KEY, mode)
}

export const getLastLocalGameMode = (): LocalSavedGameMode | null => {
  if (!isBrowserStorageAvailable()) {
    return null
  }

  const raw = window.localStorage.getItem(LAST_LOCAL_MODE_KEY)

  if (raw === 'local' || raw === 'bot-v1' || raw === 'bot-v2') {
    return raw
  }

  if (raw === 'bot') {
    return 'bot-v1'
  }

  return null
}

export const getContinueLocalGameMode = (): LocalSavedGameMode | null => {
  const localState = localStorageAdapter.loadGameState(DEFAULT_GAME_ID)
  const botV1State =
    localStorageAdapter.loadGameState(BOT_V1_GAME_ID) ??
    localStorageAdapter.loadGameState(LEGACY_BOT_GAME_ID)
  const botV2State = localStorageAdapter.loadGameState(BOT_V2_GAME_ID)
  const localInProgress = isSavedGameInProgress(localState)
  const botV1InProgress = isSavedGameInProgress(botV1State)
  const botV2InProgress = isSavedGameInProgress(botV2State)

  if (!localInProgress && !botV1InProgress && !botV2InProgress) {
    return null
  }

  const preference = getLastLocalGameMode()

  if (preference === 'bot-v2' && botV2InProgress) {
    return 'bot-v2'
  }

  if (preference === 'bot-v1' && botV1InProgress) {
    return 'bot-v1'
  }

  if (preference === 'local' && localInProgress) {
    return 'local'
  }

  if (botV2InProgress) {
    return 'bot-v2'
  }

  if (botV1InProgress) {
    return 'bot-v1'
  }

  if (localInProgress) {
    return 'local'
  }

  return null
}
