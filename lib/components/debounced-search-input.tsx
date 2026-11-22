'use client'

import { Search, X } from 'lucide-react'
import {
  type ChangeEvent,
  type FC,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState
} from 'react'

import { Input } from '@/lib/components/ui/input'
import { cn } from '@/lib/utils'
import { MAX_SEARCH_QUERY_LENGTH } from '@/lib/utils/searchQueryLimits'

export const SEARCH_DEBOUNCE_MS = 300

export interface DebouncedSearchInputProps {
  /** Committed query value (trimmed, or empty string when cleared). */
  value: string
  /** Called after typing settles or immediately on clear / Enter. */
  onSearchChange: (next: string) => void
  ariaLabel: string
  placeholder: string
  /** Bump to discard an un-debounced draft when an external Clear fires. */
  resetKey?: number
  disabled?: boolean
  className?: string
}

export const DebouncedSearchInput: FC<DebouncedSearchInputProps> = ({
  value,
  onSearchChange,
  ariaLabel,
  placeholder,
  resetKey = 0,
  disabled = false,
  className
}) => {
  const [inputValue, setInputValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCommittedRef = useRef(value)
  const prevResetKeyRef = useRef(resetKey)
  const onSearchChangeRef = useRef(onSearchChange)

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange
  }, [onSearchChange])

  const cancelDebounce = () => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }

  useEffect(() => cancelDebounce, [])

  useEffect(() => {
    if (
      value !== lastCommittedRef.current ||
      resetKey !== prevResetKeyRef.current
    ) {
      lastCommittedRef.current = value
      prevResetKeyRef.current = resetKey
      cancelDebounce()
      setInputValue(value)
    }
  }, [value, resetKey])

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed !== lastCommittedRef.current) {
      lastCommittedRef.current = trimmed
      onSearchChangeRef.current(trimmed)
    }
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextRaw = event.target.value
    setInputValue(nextRaw)
    cancelDebounce()
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      commit(nextRaw)
    }, SEARCH_DEBOUNCE_MS)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      cancelDebounce()
      commit(inputValue)
    }
  }

  const handleClear = () => {
    cancelDebounce()
    setInputValue('')
    commit('')
    inputRef.current?.focus()
  }

  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <Search
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />
      <Input
        ref={inputRef}
        type="search"
        aria-label={ariaLabel}
        value={inputValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={MAX_SEARCH_QUERY_LENGTH}
        disabled={disabled}
        className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {inputValue ? (
        <button
          type="button"
          aria-label="Clear search"
          disabled={disabled}
          onClick={handleClear}
          className="text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)] forced-colors:focus-visible:[outline-style:solid] forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[CanvasText] pointer-coarse:right-0.5 pointer-coarse:size-9 absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm outline-none transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
