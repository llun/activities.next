import {
  Brush,
  Contrast,
  Droplet,
  Focus,
  type LucideIcon,
  Minus,
  Plus,
  Sun,
  Thermometer,
  Triangle
} from 'lucide-react'

import type { AdjustmentKey } from '@/lib/services/medias/edit/recipe'

import { formatExposure, formatSigned } from './editorFormat'

export type ControlGroup = 'light' | 'colour' | 'detail' | 'effects'

export interface AdjustmentControl {
  key: AdjustmentKey
  label: string
  min: number
  max: number
  step: number
  group: ControlGroup
  icon: LucideIcon
  /** Rotate the icon half a turn (shadows is highlights upside down). */
  flipIcon?: boolean
  format: (value: number) => string
  /** Spoken value for aria-valuetext. */
  speak: (value: number) => string
}

const integer = (
  key: AdjustmentKey,
  label: string,
  group: ControlGroup,
  icon: LucideIcon,
  flipIcon = false
): AdjustmentControl => ({
  key,
  label,
  min: -100,
  max: 100,
  step: 1,
  group,
  icon,
  flipIcon,
  format: formatSigned,
  speak: formatSigned
})

export const ADJUSTMENT_CONTROLS: ReadonlyArray<AdjustmentControl> = [
  {
    key: 'exposure',
    label: 'Exposure',
    min: -5,
    max: 5,
    step: 0.01,
    group: 'light',
    icon: Sun,
    format: formatExposure,
    speak: (value) => `${formatExposure(value)} EV`
  },
  integer('contrast', 'Contrast', 'light', Contrast),
  integer('highlights', 'Highlights', 'light', Triangle),
  integer('shadows', 'Shadows', 'light', Triangle, true),
  integer('whites', 'Whites', 'light', Plus),
  integer('blacks', 'Blacks', 'light', Minus),
  integer('temperature', 'Temperature', 'colour', Thermometer),
  integer('tint', 'Tint', 'colour', Droplet),
  integer('vibrance', 'Vibrance', 'colour', Droplet),
  integer('saturation', 'Saturation', 'colour', Droplet),
  integer('texture', 'Texture', 'detail', Brush),
  integer('clarity', 'Clarity', 'detail', Focus),
  integer('vignette', 'Vignette', 'effects', Focus)
]

export const CONTROLS_BY_KEY = Object.fromEntries(
  ADJUSTMENT_CONTROLS.map((control) => [control.key, control])
) as Record<AdjustmentKey, AdjustmentControl>

export const controlsIn = (...groups: ControlGroup[]) =>
  ADJUSTMENT_CONTROLS.filter((control) => groups.includes(control.group))

export const GROUP_LABELS: Record<ControlGroup, string> = {
  light: 'Light',
  colour: 'Colour',
  detail: 'Detail',
  effects: 'Effects'
}

export const PHONE_CATEGORIES: ReadonlyArray<ControlGroup> = [
  'light',
  'colour',
  'detail',
  'effects'
]
