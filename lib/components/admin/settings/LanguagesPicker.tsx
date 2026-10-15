'use client'

import { Plus, X } from 'lucide-react'
import { FC, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/lib/components/ui/popover'

// A curated set of instance languages (code + endonym). Scales past a handful of
// toggles: selected languages render as removable chips, and new ones come from
// a searchable picker rather than one giant toggle wall.
export const LANGUAGE_OPTIONS: [string, string][] = [
  ['en', 'English'],
  ['de', 'Deutsch'],
  ['th', 'ไทย'],
  ['ja', '日本語'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['pt', 'Português'],
  ['it', 'Italiano'],
  ['nl', 'Nederlands'],
  ['sv', 'Svenska'],
  ['da', 'Dansk'],
  ['nb', 'Norsk bokmål'],
  ['fi', 'Suomi'],
  ['pl', 'Polski'],
  ['cs', 'Čeština'],
  ['uk', 'Українська'],
  ['tr', 'Türkçe'],
  ['ar', 'العربية'],
  ['hi', 'हिन्दी'],
  ['zh', '中文'],
  ['ko', '한국어'],
  ['vi', 'Tiếng Việt'],
  ['id', 'Bahasa Indonesia']
]

const labelForCode = (code: string) =>
  LANGUAGE_OPTIONS.find(([value]) => value === code)?.[1] ?? code

interface LanguagesPickerProps {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  /** The id its `FormRow` label points at. */
  id?: string
  /** The row's label, which a `<label for>` cannot give a group of chips. */
  'aria-labelledby'?: string
  /** The row's hint. */
  'aria-describedby'?: string
}

export const LanguagesPicker: FC<LanguagesPickerProps> = ({
  value,
  onChange,
  disabled,
  id,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy
}) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const normalizedQuery = query.toLowerCase()
  const remaining = LANGUAGE_OPTIONS.filter(
    ([code, name]) =>
      !value.includes(code) &&
      (name.toLowerCase().includes(normalizedQuery) ||
        code.includes(normalizedQuery))
  )

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="flex flex-wrap items-center gap-2"
    >
      {value.map((code) => (
        <span
          key={code}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pl-3 pr-1.5 text-sm font-medium text-primary-text"
        >
          {labelForCode(code)}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${labelForCode(code)}`}
              onClick={() => onChange(value.filter((c) => c !== code))}
              className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-primary/20"
            >
              <X className="h-3 w-3 text-primary" />
            </button>
          )}
        </span>
      ))}

      {value.length === 0 && disabled && (
        <span className="text-sm text-muted-foreground">
          No languages configured
        </span>
      )}

      {!disabled && (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            setQuery('')
          }}
        >
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Plus /> Add language
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            collisionPadding={8}
            className="w-60 max-w-[calc(100vw-2rem)] p-0"
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              inputRef.current?.focus()
            }}
          >
            <div className="border-b p-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search languages"
                aria-label="Search languages"
              />
            </div>
            <div className="max-h-52 overflow-y-auto p-1">
              {remaining.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No matches
                </p>
              ) : (
                remaining.map(([code, name]) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      onChange([...value, code])
                      setOpen(false)
                      setQuery('')
                    }}
                    className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span>{name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {code}
                    </span>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
