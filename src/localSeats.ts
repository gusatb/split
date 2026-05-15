import type { PlayerColor } from './types'

export type LocalSeatKind = 'human' | 'bot-v1' | 'bot-v2'

export interface LocalSeatConfig {
  player1: LocalSeatKind
  player2: LocalSeatKind
}

const LOCAL_SEAT_KEY = 'split-design:local-seat-config:v1'

const isBrowserStorageAvailable = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

export const defaultLocalSeatConfig = (): LocalSeatConfig => ({
  player1: 'human',
  player2: 'human',
})

export const getSeatForPlayer = (config: LocalSeatConfig, player: PlayerColor): LocalSeatKind =>
  player === 'player1' ? config.player1 : config.player2

export const saveLocalSeatConfig = (config: LocalSeatConfig) => {
  if (!isBrowserStorageAvailable()) {
    return
  }

  window.localStorage.setItem(LOCAL_SEAT_KEY, JSON.stringify(config))
}

export const loadLocalSeatConfig = (): LocalSeatConfig | null => {
  if (!isBrowserStorageAvailable()) {
    return null
  }

  const raw = window.localStorage.getItem(LOCAL_SEAT_KEY)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (
      parsed &&
      typeof parsed === 'object' &&
      'player1' in parsed &&
      'player2' in parsed &&
      isSeatKind((parsed as LocalSeatConfig).player1) &&
      isSeatKind((parsed as LocalSeatConfig).player2)
    ) {
      return parsed as LocalSeatConfig
    }
  } catch {
    window.localStorage.removeItem(LOCAL_SEAT_KEY)
  }

  return null
}

const isSeatKind = (value: unknown): value is LocalSeatKind =>
  value === 'human' || value === 'bot-v1' || value === 'bot-v2'
