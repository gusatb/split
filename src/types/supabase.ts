export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      games: {
        Row: {
          id: string
          short_code: string
          state: Json | null
          status: 'waiting' | 'playing' | 'finished' | string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          short_code: string
          state?: Json | null
          status?: 'waiting' | 'playing' | 'finished' | string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          short_code?: string
          state?: Json | null
          status?: 'waiting' | 'playing' | 'finished' | string
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type GameRow = Database['public']['Tables']['games']['Row']
