import { getSupabaseClient } from './lib/supabase'
import { createInitialGameState, type GameState } from './useGameState'
import type { GameRow, Json } from './types/supabase'

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SHORT_CODE_LENGTH = 4
const MAX_CREATE_ATTEMPTS = 6

const isObjectWithKey = <TKey extends string>(
  value: unknown,
  key: TKey,
): value is Record<TKey, unknown> => typeof value === 'object' && value !== null && key in value

export const getOnlineErrorMessage = (error: unknown, fallback = 'Unable to start online game.') => {
  if (error instanceof Error) {
    return error.message
  }

  if (isObjectWithKey(error, 'message') && typeof error.message === 'string') {
    const details = [
      error.message,
      isObjectWithKey(error, 'code') && typeof error.code === 'string' ? `Code: ${error.code}` : null,
      isObjectWithKey(error, 'details') && typeof error.details === 'string'
        ? `Details: ${error.details}`
        : null,
      isObjectWithKey(error, 'hint') && typeof error.hint === 'string' ? `Hint: ${error.hint}` : null,
    ].filter(Boolean)

    return details.join(' ')
  }

  if (typeof error === 'string') {
    return error
  }

  return fallback
}

const getOnlineGameError = (error: unknown) => {
  const message = getOnlineErrorMessage(error)

  if (message.includes('relation') && message.includes('games')) {
    return new Error(
      'Online game table is missing. Supabase migrations have not been applied yet. Check the Supabase GitHub Integration migration run.',
    )
  }

  if (message.includes('supabase_migrations.schema_migrations')) {
    return new Error(
      'Supabase migration history is missing. Run supabase/bootstrap_schema_migrations.sql once in the Supabase SQL editor, then re-run the GitHub Integration.',
    )
  }

  return new Error(message)
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
  let lastError: unknown = null

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

  throw getOnlineGameError(
    lastError ??
      new Error(
        'Supabase insert did not return a game row. Check insert/select RLS policies for public.games.',
      ),
  )
}

export const checkOnlineGameSetup = async () => {
  const { error } = await getSupabaseClient().from('games').select('id').limit(1)

  if (error) {
    throw getOnlineGameError(error)
  }
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
