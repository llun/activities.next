'use client'

import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { getGallerySettings, updateGallerySettings } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Label } from '@/lib/components/ui/label'
import { Switch } from '@/lib/components/ui/switch'
import type { GallerySettingsEntity } from '@/lib/services/gallery/galleryEntities'
import type { GallerySettings } from '@/lib/types/database/gallery'

/**
 * The settings form plumbing shared by Settings › Media and Gallery › Privacy:
 * one load, then an optimistic save per key. A key with a save in flight stays
 * enabled (disabling it would drop keyboard focus) but is `aria-busy` and
 * ignores a repeat change; a failure reverts only that key; only the newest
 * response for a key may apply or revert it.
 */

const DEFAULT_SAVE_ERROR = 'Failed to save media settings. Please try again.'
const DEFAULT_LOAD_ERROR = 'Failed to load media settings.'
const SAVED_STATUS = 'Saved'
const SAVED_STATUS_MS = 2000

interface GallerySettingsFormOptions {
  /** Shown when a save fails; the media settings wording by default. */
  saveError?: string
  loadError?: string
}

export const useGallerySettingsForm = <K extends keyof GallerySettings>({
  saveError: saveErrorMessage = DEFAULT_SAVE_ERROR,
  loadError: loadErrorMessage = DEFAULT_LOAD_ERROR
}: GallerySettingsFormOptions = {}) => {
  const [settings, setSettings] = useState<GallerySettingsEntity | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savingKeys, setSavingKeys] = useState<ReadonlySet<K>>(() => new Set())
  const [savedStatus, setSavedStatus] = useState<string | null>(null)
  // Each load gets a number; only the newest one may apply its result, so a
  // retry cannot be overwritten by an older request that finishes later.
  const loadRequest = useRef(0)
  // Per-key save numbering: keys with a save in flight are refused
  // synchronously, so two saves for one key never overlap and `previous` is
  // always the last confirmed value.
  const saveSequence = useRef<Partial<Record<K, number>>>({})
  const pendingKeys = useRef<Set<K>>(new Set())
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSavedTimer = useCallback(() => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = null
  }, [])

  const loadSettings = useCallback(() => {
    const request = ++loadRequest.current
    setLoadError(null)
    getGallerySettings().then(
      (loaded) => {
        if (request === loadRequest.current) setSettings(loaded)
      },
      () => {
        if (request === loadRequest.current) setLoadError(loadErrorMessage)
      }
    )
  }, [])

  useEffect(() => {
    loadSettings()
    return () => {
      loadRequest.current += 1
      clearSavedTimer()
    }
  }, [loadSettings, clearSavedTimer])

  // Optimistic: the control flips at once, reverts only its own key on failure,
  // and takes the server's value when the save succeeds.
  const save = async <Key extends K>(key: Key, value: GallerySettings[Key]) => {
    if (pendingKeys.current.has(key)) return
    pendingKeys.current.add(key)
    const sequence = (saveSequence.current[key] ?? 0) + 1
    saveSequence.current[key] = sequence
    const isLatest = () => saveSequence.current[key] === sequence
    const previous = settings?.[key]
    clearSavedTimer()
    setSavedStatus(null)
    setSettings((current) => (current ? { ...current, [key]: value } : current))
    setSaveError(null)
    setSavingKeys((current) => new Set(current).add(key))
    try {
      const saved = await updateGallerySettings({ [key]: value })
      if (!isLatest()) return
      setSettings((current) =>
        current ? { ...current, [key]: saved[key] } : current
      )
      setSavedStatus(SAVED_STATUS)
      savedTimer.current = setTimeout(() => {
        savedTimer.current = null
        setSavedStatus(null)
      }, SAVED_STATUS_MS)
    } catch {
      if (!isLatest()) return
      setSettings((current) =>
        current && previous !== undefined
          ? { ...current, [key]: previous }
          : current
      )
      setSaveError(saveErrorMessage)
    } finally {
      pendingKeys.current.delete(key)
      setSavingKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  return {
    settings,
    loaded: settings !== null,
    loadError,
    saveError,
    savedStatus,
    savingKeys,
    loadSettings,
    save
  }
}

interface StatusProps {
  loadError: string | null
  saveError: string | null
  savedStatus: string | null
  onRetry: () => void
}

/** The load error with Retry, the save error, and the polite "Saved" status. */
export const GallerySettingsStatus: FC<StatusProps> = ({
  loadError,
  saveError,
  savedStatus,
  onRetry
}) => (
  <div className="min-h-5 space-y-2 text-sm">
    {loadError && (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 text-destructive"
      >
        <p>{loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )}
    {saveError && (
      <p role="alert" className="text-destructive">
        {saveError}
      </p>
    )}
    <p role="status" aria-live="polite" className="text-muted-foreground">
      {savedStatus}
    </p>
  </div>
)

interface ToggleRowProps {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  /** A save is in flight: announced, but the control stays enabled and focused. */
  busy: boolean
  notice?: string
  onCheckedChange: (checked: boolean) => void
}

export const ToggleRow: FC<ToggleRowProps> = ({
  id,
  label,
  description,
  checked,
  disabled,
  busy,
  notice,
  onCheckedChange
}) => (
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0 space-y-0.5">
      <Label htmlFor={id} className="cursor-pointer">
        {label}
      </Label>
      <p className="text-[0.8rem] text-muted-foreground">{description}</p>
      {notice && (
        <p className="text-[0.8rem] text-muted-foreground">{notice}</p>
      )}
    </div>
    <div className="shrink-0">
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-busy={busy}
        onCheckedChange={onCheckedChange}
      />
    </div>
  </div>
)
