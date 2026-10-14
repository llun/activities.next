'use client'

import {
  CircleDashed,
  Crop as CropIcon,
  SlidersHorizontal,
  Sparkles,
  WandSparkles
} from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/lib/components/ui/button'
import { TabsContent, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'
import type { AdjustmentKey } from '@/lib/services/medias/edit/recipe'

import { CropPanel } from './CropPanel'
import { PhoneSliderPanel } from './PhoneSliderPanel'
import { PillGroup } from './PillGroup'
import { PresetsPanel } from './PresetsPanel'
import {
  CONTROLS_BY_KEY,
  type ControlGroup,
  GROUP_LABELS,
  PHONE_CATEGORIES,
  controlsIn
} from './adjustmentControls'
import type { EditorControls } from './editorControls'
import { MasksPhoneControls } from './masks/MasksPhoneControls'

interface Props {
  controls: EditorControls
  category: ControlGroup
  selected: AdjustmentKey
  onCategoryChange: (category: ControlGroup) => void
  onSelect: (key: AdjustmentKey) => void
  /** The chosen slider of the Masks tab (a slider key, or "feather"). */
  maskSelected: string
  onMaskSelect: (key: string) => void
  alerts: ReactNode
}

const TAB_CLASS =
  'h-full flex-col gap-0.5 rounded-none border-0 text-[11px] data-[state=active]:bg-transparent data-[state=active]:text-primary-text data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent'

/**
 * The phone controls: a category control with Auto, a row of 58 px chips
 * (a dot marks a changed value), one large slider for the chosen chip, and
 * the Adjust / Crop / Masks tab bar, plus Presets when enhance is available. The
 * Crop, Masks and Presets tabs replace the chip area.
 */
export const EditorPhoneControls = ({
  controls,
  category,
  selected,
  onCategoryChange,
  onSelect,
  maskSelected,
  onMaskSelect,
  alerts
}: Props) => {
  const { recipe, disabled } = controls
  const chips = controlsIn(category)
  const current =
    CONTROLS_BY_KEY[
      chips.some((c) => c.key === selected) ? selected : chips[0].key
    ]

  return (
    <div className="shrink-0 border-t bg-background">
      {alerts ? <div className="p-3 pb-0">{alerts}</div> : null}
      <TabsContent value="adjust" className="space-y-3 pt-3">
        <div className="flex items-center gap-2 px-3">
          <PillGroup
            aria-label="Adjustment category"
            compact
            className="min-w-0 flex-1 flex-nowrap"
            items={PHONE_CATEGORIES.map((group) => ({
              value: group,
              label: GROUP_LABELS[group]
            }))}
            value={category}
            disabled={disabled}
            onValueChange={(next) => onCategoryChange(next as ControlGroup)}
          />
          <Button
            type="button"
            variant="pill"
            size="sm"
            className="shrink-0 px-2.5 text-[13px] max-md:min-h-10"
            disabled={disabled}
            onClick={controls.onAuto}
          >
            <WandSparkles aria-hidden="true" />
            Auto
          </Button>
        </div>
        {controls.autoStatus ? (
          <p className="px-3 text-xs text-muted-foreground">
            {controls.autoStatus}
          </p>
        ) : null}
        <PhoneSliderPanel
          controls={chips}
          groupLabel={`${GROUP_LABELS[category]} adjustments`}
          selected={current.key}
          onSelect={(key) => onSelect(key as AdjustmentKey)}
          valueOf={(key) => recipe.adjustments[key as AdjustmentKey] ?? 0}
          onChange={(key, value) =>
            controls.onAdjust(key as AdjustmentKey, value)
          }
          onGestureStart={controls.onGestureStart}
          onGestureEnd={controls.onGestureEnd}
          disabled={disabled}
        />
      </TabsContent>
      <TabsContent value="crop">
        <CropPanel controls={controls} compact />
      </TabsContent>
      <TabsContent value="masks">
        <MasksPhoneControls
          controls={controls}
          selected={maskSelected}
          onSelect={onMaskSelect}
        />
      </TabsContent>
      {controls.ai.available ? (
        <TabsContent value="presets">
          <PresetsPanel controls={controls} compact />
        </TabsContent>
      ) : null}
      <TabsList className="h-[58px] w-full rounded-none border-t bg-background p-0">
        <TabsTrigger value="adjust" className={TAB_CLASS}>
          <SlidersHorizontal aria-hidden="true" />
          Adjust
        </TabsTrigger>
        <TabsTrigger value="crop" className={TAB_CLASS}>
          <CropIcon aria-hidden="true" />
          Crop
        </TabsTrigger>
        <TabsTrigger value="masks" className={TAB_CLASS}>
          <CircleDashed aria-hidden="true" />
          Masks
        </TabsTrigger>
        {controls.ai.available ? (
          <TabsTrigger value="presets" className={TAB_CLASS}>
            <Sparkles aria-hidden="true" />
            Presets
          </TabsTrigger>
        ) : null}
      </TabsList>
    </div>
  )
}
