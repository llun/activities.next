'use client'

import { WandSparkles } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { countChangedAdjustments } from '@/lib/services/medias/edit/recipe'

import { AdjustmentRow } from './AdjustmentRow'
import { type ControlGroup, controlsIn } from './adjustmentControls'
import type { EditorControls } from './editorControls'

const RESET_CLASS = 'h-6 px-2 text-xs'

const SectionHeader = ({
  title,
  changed,
  onReset,
  children
}: {
  title: string
  changed: boolean
  onReset: () => void
  children?: React.ReactNode
}) => (
  <div className="flex items-center justify-between">
    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {title}
    </h3>
    <div className="flex items-center gap-1">
      {changed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={RESET_CLASS}
          aria-label={`Reset ${title}`}
          onClick={onReset}
        >
          Reset
        </Button>
      ) : null}
      {children}
    </div>
  </div>
)

/** The desktop Adjust tab: Auto, Light, Colour and a collapsed Detail · Effects. */
export const AdjustPanel = ({ controls }: { controls: EditorControls }) => {
  const [detailOpen, setDetailOpen] = useState(false)
  const { recipe, disabled } = controls

  const renderRows = (groups: ControlGroup[]) =>
    controlsIn(...groups).map((control) => (
      <AdjustmentRow
        key={control.key}
        control={control}
        value={recipe.adjustments[control.key] ?? 0}
        disabled={disabled}
        onChange={(value) => controls.onAdjust(control.key, value)}
        onGestureStart={() => controls.onGestureStart(control.key)}
        onGestureEnd={controls.onGestureEnd}
      />
    ))
  const changedIn = (groups: ControlGroup[]) =>
    countChangedAdjustments(
      Object.fromEntries(
        controlsIn(...groups).map((control) => [
          control.key,
          recipe.adjustments[control.key] ?? 0
        ])
      )
    ) > 0

  const light: ControlGroup[] = ['light']
  const colour: ControlGroup[] = ['colour']
  const detail: ControlGroup[] = ['detail', 'effects']

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="pill"
          size="sm"
          disabled={disabled}
          onClick={controls.onAuto}
        >
          <WandSparkles aria-hidden="true" />
          Auto
        </Button>
        {controls.autoStatus ? (
          <span className="text-xs text-muted-foreground">
            {controls.autoStatus}
          </span>
        ) : null}
      </div>

      <section className="space-y-3" aria-label="Light">
        <SectionHeader
          title="Light"
          changed={changedIn(light)}
          onReset={() => controls.onResetGroups(light)}
        />
        {renderRows(light)}
      </section>

      <section className="space-y-3" aria-label="Colour">
        <SectionHeader
          title="Colour"
          changed={changedIn(colour)}
          onReset={() => controls.onResetGroups(colour)}
        />
        {renderRows(colour)}
      </section>

      <section className="space-y-3" aria-label="Detail and effects">
        <SectionHeader
          title="Detail · Effects"
          changed={detailOpen && changedIn(detail)}
          onReset={() => controls.onResetGroups(detail)}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={RESET_CLASS}
            aria-expanded={detailOpen}
            onClick={() => setDetailOpen((open) => !open)}
          >
            {detailOpen ? 'Hide' : 'Show'}
          </Button>
        </SectionHeader>
        {detailOpen ? renderRows(detail) : null}
      </section>
    </div>
  )
}
