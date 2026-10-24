'use client'

import { FC, useEffect, useRef, useState } from 'react'

import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SavedIndicator } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { ThemeControl } from '@/lib/components/theme'

const SAVED_MS = 2000

/**
 * Settings › Appearance. The theme is a device-local preference that
 * applies the moment it is picked, so it shows the quiet "Saved" tick in the
 * section's actions instead of asking for a Save. It sits outside the page's
 * native `<form>` (its radios are not form fields and must not mark it dirty).
 */
export const AppearanceSection: FC = () => {
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const handleSelect = () => {
    if (timer.current) clearTimeout(timer.current)
    setSaved(true)
    timer.current = setTimeout(() => setSaved(false), SAVED_MS)
  }

  return (
    <Section
      title="Appearance"
      description="The theme for this device."
      actions={<SavedIndicator saved={saved} />}
    >
      <Frame form>
        <FormRow
          label="Theme"
          hint="System follows this device’s setting. Saved instantly on this device."
        >
          {({ describedBy }) => (
            <ThemeControl
              variant="full"
              onSelect={handleSelect}
              describedBy={describedBy}
            />
          )}
        </FormRow>
      </Frame>
    </Section>
  )
}
