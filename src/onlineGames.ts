import { getSupabaseClient } from './lib/supabase'
import { createInitialGameState, type GameState } from './useGameState'
import type { GameRow, Json } from './types/supabase'

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SHORT_CODE_LENGTH = 4
const MAX_CREATE_ATTEMPTS = 6

const getOnlineGameError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return new Error('Unable to start online game.')
  }

  if (error.message.includes('relation') && error.message.includes('games')) {
    return new Error(
      'Online game table is missing. Supabase migrations have not been applied yet. Check the Supabase GitHub Integration migration run.',
    )
  }

  if (error.message.includes('supabase_migrations.schema_migrations')) {
    return new Error(
      'Supabase migration history is missing. Run supabase/bootstrap_schema_migrations.sql once in the Supabase SQL editor, then re-run the GitHub Integration.',
    )
  }

  return error
}

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

  throw getOnlineGameError(lastError ?? new Error('Unable to create online game.'))
}

export const joinOnlineGame = async (shortCode: string) => {
  const normalizedCode = shortCode.trim().toUpperCase()
  const { data: game, error: findError } = await getSupabaseClient()
    .from('games')
    .select()
    .eq('short_code', normalizedCode)
    .maybeSingle()

  if (findError) {
    throw getOnlineGameError(findError)
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
    throw getOnlineGameError(updateError)
  }

  return toGameSession(updatedGame)
}
