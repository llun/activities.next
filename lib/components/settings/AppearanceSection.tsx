'use client'

import { FC, ReactNode, useEffect, useRef, useState } from 'react'

import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SavedIndicator } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { ThemeControl } from '@/lib/components/theme'

const SAVED_MS = 2000

interface Props {
  /** More rows for the same frame, such as the post line limit. */
  children?: ReactNode
}

/**
 * Settings › General › Appearance. The theme is a device-local preference that
 * applies the moment it is picked, so it shows the quiet "Saved" tick in the
 * section's actions instead of asking for a Save; the rows passed as children
 * belong to the page's form and save with it.
 */
export const AppearanceSection: FC<Props> = ({ children }) => {
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
      description="Theme for this device, and how posts appear on your timeline."
      actions={<SavedIndicator saved={saved} />}
    >
      <Frame divided>
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
        {children}
      </Frame>
    </Section>
  )
}
