import { getSupabaseClient } from './lib/supabase'
import { createInitialGameState, type GameState } from './useGameState'
import type { GameRow, Json } from './types/supabase'

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SHORT_CODE_LENGTH = 4
const MAX_CREATE_ATTEMPTS = 6

export interface OnlineGameSession {
  id: string
  shortCode: string
  initialState: GameState
}

export const generateShortCode = () =>
  Array.from({ length: SHORT_CODE_LENGTH }, () =>
    SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)],
  ).join('')

const toGameSession = (row: GameRow): OnlineGameSession => ({
  id: row.id,
  shortCode: row.short_code,
  initialState: (row.state as unknown as GameState | null) ?? createInitialGameState(),
})

export const createOnlineGame = async () => {
  const initialState = createInitialGameState()
  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const shortCode = generateShortCode()
    const { data, error } = await getSupabaseClient()
      .from('games')
      .insert({
        short_code: shortCode,
        state: initialState as unknown as Json,
        status: 'waiting',
      })
      .select()
      .single()

    if (!error && data) {
      return toGameSession(data)
    }

    lastError = error
  }

  throw lastError ?? new Error('Unable to create online game.')
}

export const joinOnlineGame = async (shortCode: string) => {
  const normalizedCode = shortCode.trim().toUpperCase()
  const { data: game, error: findError } = await getSupabaseClient()
    .from('games')
    .select()
    .eq('short_code', normalizedCode)
    .maybeSingle()

  if (findError) {
    throw findError
  }

  if (!game) {
    throw new Error(`No game found for code ${normalizedCode}.`)
  }

  const { data: updatedGame, error: updateError } = await getSupabaseClient()
    .from('games')
    .update({
      status: 'playing',
      state: (game.state ?? createInitialGameState()) as Json,
    })
    .eq('id', game.id)
    .select()
    .single()

  if (updateError) {
    throw updateError
  }

  return toGameSession(updatedGame)
}
