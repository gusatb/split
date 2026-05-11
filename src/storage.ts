import type { GameState } from './useGameState'

const DEFAULT_GAME_ID = 'local-pass-and-play'
const STORAGE_PREFIX = 'split-design:game-state:v1'

export interface StorageAdapter {
  saveGameState(state: GameState, gameId?: string): void
  loadGameState(gameId: string): GameState | null
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
}

export const defaultGameId = DEFAULT_GAME_ID
export const localStorageAdapter = new LocalStorageAdapter()
