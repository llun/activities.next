'use client'

import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { getGallerySettings, updateGallerySettings } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Label } from '@/lib/components/ui/label'
import { Switch } from '@/lib/components/ui/switch'
import type { GallerySettingsEntity } from '@/lib/services/gallery/galleryEntities'
import type { GallerySettings } from '@/lib/types/database/gallery'

type ToggleKey = keyof Pick<
  GallerySettings,
  'autoDescribe' | 'allowEmptyDescription' | 'subjectHashtags'
>

const SAVE_ERROR = 'Failed to save media settings. Please try again.'
const LOAD_ERROR = 'Failed to load media settings.'
const SAVED_STATUS = 'Saved'
const SAVED_STATUS_MS = 2000

interface ToggleRowProps {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  notice?: string
  onCheckedChange: (checked: boolean) => void
}

const ToggleRow: FC<ToggleRowProps> = ({
  id,
  label,
  description,
  checked,
  disabled,
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
        onCheckedChange={onCheckedChange}
      />
    </div>
  </div>
)

export const MediaDetailsSettings: FC = () => {
  const [settings, setSettings] = useState<GallerySettingsEntity | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Keys with a save in flight. Only the switch whose save is pending is
  // disabled; the others stay usable.
  const [savingKeys, setSavingKeys] = useState<ReadonlySet<ToggleKey>>(
    () => new Set()
  )
  const [savedStatus, setSavedStatus] = useState<string | null>(null)
  // Each load gets a number; only the newest one may apply its result, so a
  // retry cannot be overwritten by an older request that finishes later.
  const loadRequest = useRef(0)
  // Per-key save numbering: only the newest response for a key may apply or
  // revert that key. Keys with a save in flight are refused synchronously, so
  // two saves for one key never overlap and `previous` is always the last
  // confirmed value.
  const saveSequence = useRef<Partial<Record<ToggleKey, number>>>({})
  const pendingKeys = useRef<Set<ToggleKey>>(new Set())
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
        if (request === loadRequest.current) setLoadError(LOAD_ERROR)
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

  // Optimistic: the switch flips at once, reverts only its own key on failure,
  // and takes the server's value when the save succeeds.
  const handleToggle = async (key: ToggleKey, value: boolean) => {
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
      setSaveError(SAVE_ERROR)
    } finally {
      pendingKeys.current.delete(key)
      setSavingKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const loaded = settings !== null
  const altTextAvailable = settings?.altTextAvailable ?? false

  return (
    <div className="space-y-6">
      <div className="min-h-5 space-y-2 text-sm">
        {loadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-destructive"
          >
            <p>{loadError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadSettings}
            >
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

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Descriptions (alt text)</h2>
          <p className="text-sm text-muted-foreground">
            Alt text describes a photo for people who cannot see it.
          </p>
        </div>

        <ToggleRow
          id="media-auto-describe"
          label="Describe new photos and videos automatically"
          description="Writes a description when you attach media. You can edit or regenerate it in media details."
          notice={
            loaded && !altTextAvailable
              ? 'Not available on this server.'
              : undefined
          }
          checked={settings?.autoDescribe ?? false}
          disabled={
            !loaded || !altTextAvailable || savingKeys.has('autoDescribe')
          }
          onCheckedChange={(checked) => handleToggle('autoDescribe', checked)}
        />

        <ToggleRow
          id="media-allow-empty-description"
          label="Allow posting media without a description"
          description="When off, every item needs a description or must be marked decorative."
          checked={settings?.allowEmptyDescription ?? false}
          disabled={!loaded || savingKeys.has('allowEmptyDescription')}
          onCheckedChange={(checked) =>
            handleToggle('allowEmptyDescription', checked)
          }
        />
      </section>

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Subjects</h2>
          <p className="text-sm text-muted-foreground">
            How the subject of a photo appears in your posts.
          </p>
        </div>

        <ToggleRow
          id="media-subject-hashtags"
          label="Add subjects as hashtags"
          description="Adds a hashtag such as #CommonKingfisher to the post for each subject."
          checked={settings?.subjectHashtags ?? false}
          disabled={!loaded || savingKeys.has('subjectHashtags')}
          onCheckedChange={(checked) =>
            handleToggle('subjectHashtags', checked)
          }
        />
      </section>
    </div>
  )
}
