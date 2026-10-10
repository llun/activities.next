'use client'

import { Feather, Plus } from 'lucide-react'
import { useState } from 'react'

import { PhoneSliderPanel } from '@/lib/components/photo-editor/PhoneSliderPanel'
import type { PhoneControl } from '@/lib/components/photo-editor/PhoneSliderPanel'
import { PillGroup } from '@/lib/components/photo-editor/PillGroup'
import { MASK_CONTROLS } from '@/lib/components/photo-editor/adjustmentControls'
import type { EditorControls } from '@/lib/components/photo-editor/editorControls'
import { Button } from '@/lib/components/ui/button'

import {
  MaskAddButtons,
  MaskModelStatus,
  MaskRefineControls
} from './MaskParts'
import { MASK_COPY } from './maskCopy'
import { DEFAULT_FEATHER, getMaskName } from './maskRecipe'

const FEATHER_KEY = 'feather'

const FEATHER_CONTROL: PhoneControl = {
  key: FEATHER_KEY,
  label: MASK_COPY.feather,
  icon: Feather,
  min: 0,
  max: 100,
  step: 1,
  bipolar: false,
  defaultValue: DEFAULT_FEATHER,
  format: (value) => `${value}`,
  speak: (value) => `${value}`
}

const PHONE_MASK_CONTROLS: ReadonlyArray<PhoneControl> = [
  ...MASK_CONTROLS,
  FEATHER_CONTROL
]

interface Props {
  controls: EditorControls
  selected: string
  onSelect: (key: string) => void
}

/**
 * The phone Masks tab: a pill per mask and "+ New mask", the refine row, and
 * the mask's chips (its sliders and Feather) with one large slider.
 */
export const MasksPhoneControls = ({ controls, selected, onSelect }: Props) => {
  const tools = controls.masks
  const { recipe, disabled } = controls
  const { selected: mask } = tools
  // The "new mask" row closes by itself once a mask is added.
  const [openAt, setOpenAt] = useState<number | null>(null)
  const newOpen = openAt === tools.masks.length

  return (
    <div className="space-y-3 pt-3">
      <div className="px-3 empty:hidden">
        <MaskModelStatus tools={tools} />
      </div>

      <div className="flex items-center gap-2 px-3">
        {tools.masks.length > 0 ? (
          <PillGroup
            aria-label="Masks"
            className="min-w-0 flex-1"
            items={tools.masks.map((item) => ({
              value: item.id,
              label: getMaskName(recipe, item.id)
            }))}
            value={tools.selectedId ?? ''}
            disabled={disabled}
            onValueChange={tools.select}
          />
        ) : (
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {MASK_COPY.empty}
          </p>
        )}
        <Button
          type="button"
          variant="pill"
          size="sm"
          className="shrink-0 px-2.5 text-[13px] max-md:min-h-10"
          aria-expanded={newOpen}
          disabled={disabled || tools.atLimit}
          onClick={() => setOpenAt(newOpen ? null : tools.masks.length)}
        >
          <Plus aria-hidden="true" />
          {MASK_COPY.newMask}
        </Button>
      </div>

      {newOpen || tools.masks.length === 0 || tools.atLimit ? (
        <div className="px-3">
          <MaskAddButtons tools={tools} disabled={disabled} />
        </div>
      ) : null}

      {mask ? (
        <>
          <div className="px-3">
            <MaskRefineControls tools={tools} disabled={disabled} />
          </div>
          <PhoneSliderPanel
            controls={PHONE_MASK_CONTROLS}
            groupLabel={`${getMaskName(recipe, mask.id)} adjustments`}
            selected={selected}
            onSelect={onSelect}
            valueOf={(key) =>
              key === FEATHER_KEY
                ? mask.feather
                : (mask.adjustments[key as keyof typeof mask.adjustments] ?? 0)
            }
            neutralOf={(key) => (key === FEATHER_KEY ? DEFAULT_FEATHER : 0)}
            onChange={(key, value) =>
              key === FEATHER_KEY
                ? tools.setFeather(value)
                : tools.adjust(key as keyof typeof mask.adjustments, value)
            }
            onGestureStart={(key) =>
              controls.onGestureStart(`${mask.id}:${key}`)
            }
            onGestureEnd={controls.onGestureEnd}
            disabled={disabled}
          />
        </>
      ) : null}
    </div>
  )
}
