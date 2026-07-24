'use client'

import { Plus, Search, X } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'

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
}

export const LanguagesPicker: FC<LanguagesPickerProps> = ({
  value,
  onChange,
  disabled
}) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const normalizedQuery = query.toLowerCase()
  const remaining = LANGUAGE_OPTIONS.filter(
    ([code, name]) =>
      !value.includes(code) &&
      (name.toLowerCase().includes(normalizedQuery) ||
        code.includes(normalizedQuery))
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((code) => (
        <span
          key={code}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pl-3 pr-1.5 text-sm font-medium text-primary"
        >
          {labelForCode(code)}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${labelForCode(code)}`}
              onClick={() => onChange(value.filter((c) => c !== code))}
              className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-primary/20"
            >
              <X className="h-3 w-3" />
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
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setOpen((current) => !current)
              setQuery('')
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60"
          >
            <Plus className="h-3.5 w-3.5" /> Add language
          </button>
          {open && (
            <>
              {/* Click-away layer. */}
              <div
                className="fixed inset-0 z-30"
                aria-hidden
                onClick={() => setOpen(false)}
              />
              <div className="absolute left-0 top-9 z-40 w-60 rounded-xl border bg-background shadow-lg">
                <div className="border-b p-2">
                  <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search languages"
                      aria-label="Search languages"
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </div>
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
                        className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <span>{name}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {code}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
