import type { LineColor, PlayerColor } from './types'

export type ThemeId = 'synth' | 'tactile'

export interface PlayerTheme {
  stroke: string
  fill: string
}

export interface FreeAreaGlow {
  color: string
  blur: number
}

export interface ThemeConfig {
  id: ThemeId
  label: string
  background: string
  text: string
  mutedText: string
  panel: string
  border: string
  accent: string
  neutralLine: string
  pendingFill: string
  pendingStroke: string
  freeFill: string
  freeStroke: string
  /** Halo for neutral areas at or below the fill capture limit (visible without inspection). */
  freeAreaGlow: FreeAreaGlow
  players: Record<PlayerColor, PlayerTheme>
  effects: {
    shadowBlur: number
    shadowColor: 'stroke' | string
    shadowOffsetX: number
    shadowOffsetY: number
  }
  cursor: 'glowCircle' | 'crosshair'
}

export const themes: Record<ThemeId, ThemeConfig> = {
  synth: {
    id: 'synth',
    label: 'Synth & Wireframe',
    background: '#121212',
    text: '#F8FAFC',
    mutedText: '#A3A3A3',
    panel: 'rgba(24, 24, 27, 0.82)',
    border: 'rgba(0, 255, 255, 0.32)',
    accent: '#00FFFF',
    neutralLine: '#404040',
    pendingFill: 'rgba(255, 255, 0, 0.16)',
    pendingStroke: '#FFFF00',
    freeFill: 'rgba(253, 224, 71, 0.1)',
    freeStroke: 'rgba(250, 204, 21, 0.72)',
    freeAreaGlow: {
      color: 'rgba(253, 224, 71, 0.5)',
      blur: 18,
    },
    players: {
      player1: {
        stroke: '#00FFFF',
        fill: 'rgba(0, 255, 255, 0.15)',
      },
      player2: {
        stroke: '#FF00FF',
        fill: 'rgba(255, 0, 255, 0.15)',
      },
    },
    effects: {
      shadowBlur: 10,
      shadowColor: 'stroke',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    },
    cursor: 'glowCircle',
  },
  tactile: {
    id: 'tactile',
    label: 'Tactile Minimalist',
    background: '#F9F6F0',
    text: '#1A1A1A',
    mutedText: '#60584E',
    panel: 'rgba(255, 252, 246, 0.92)',
    border: 'rgba(26, 26, 26, 0.18)',
    accent: '#C04000',
    neutralLine: '#1A1A1A',
    pendingFill: 'rgba(192, 64, 0, 0.14)',
    pendingStroke: '#C04000',
    freeFill: 'rgba(22, 163, 74, 0.12)',
    freeStroke: 'rgba(14, 110, 58, 0.72)',
    freeAreaGlow: {
      color: 'rgba(52, 211, 153, 0.48)',
      blur: 16,
    },
    players: {
      player1: {
        stroke: '#C04000',
        fill: 'rgba(192, 64, 0, 0.8)',
      },
      player2: {
        stroke: '#2F4F4F',
        fill: 'rgba(47, 79, 79, 0.8)',
      },
    },
    effects: {
      shadowBlur: 2,
      shadowColor: 'rgba(0,0,0,0.2)',
      shadowOffsetX: 1,
      shadowOffsetY: 2,
    },
    cursor: 'crosshair',
  },
}

export const getLineStroke = (theme: ThemeConfig, color: LineColor) =>
  color === 'neutral' ? theme.neutralLine : theme.players[color].stroke

export const getAreaFill = (theme: ThemeConfig, color: LineColor) =>
  color === 'neutral' ? 'rgba(255, 255, 255, 0)' : theme.players[color].fill
