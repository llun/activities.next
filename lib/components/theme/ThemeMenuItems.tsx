'use client'

import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react'
import { FC } from 'react'

import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '@/lib/components/ui/dropdown-menu'

import { useTheme } from './ThemeProvider'
import { type ThemeMode } from './theme-core'

const OPTIONS: { mode: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
  // System is last so the two explicit modes stay adjacent.
  { mode: 'system', label: 'System', Icon: Monitor }
]

// The theme picker rendered as accessible menu radio items, for hosting inside a
// Radix DropdownMenu (the mobile "More" sheet). Unlike the segmented pill, a
// `role=menuitemradio` node is reachable via the menu's roving keyboard focus
// and is valid ARIA inside a `role=menu` container — a plain-button control
// nested in the menu is keyboard-unreachable and announced incorrectly.
export const ThemeMenuItems: FC = () => {
  const { theme, setTheme } = useTheme()
  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        Theme
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={theme}
        onValueChange={(value) => setTheme(value as ThemeMode)}
      >
        {OPTIONS.map(({ mode, label, Icon }) => (
          <DropdownMenuRadioItem key={mode} value={mode}>
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}
