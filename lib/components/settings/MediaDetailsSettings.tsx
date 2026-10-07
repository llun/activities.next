'use client'

import { FC, useEffect, useState } from 'react'

import { getGallerySettings, updateGallerySettings } from '@/lib/client'
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
  const [savingKey, setSavingKey] = useState<ToggleKey | null>(null)

  useEffect(() => {
    let active = true
    getGallerySettings()
      .then((loaded) => {
        if (active) setSettings(loaded)
      })
      .catch(() => {
        if (active) setLoadError(LOAD_ERROR)
      })
    return () => {
      active = false
    }
  }, [])

  // Optimistic: the switch flips at once, reverts only its own key on failure,
  // and takes the server's value when the save succeeds.
  const handleToggle = async (key: ToggleKey, value: boolean) => {
    const previous = settings?.[key]
    setSettings((current) => (current ? { ...current, [key]: value } : current))
    setSaveError(null)
    setSavingKey(key)
    try {
      const saved = await updateGallerySettings({ [key]: value })
      setSettings((current) =>
        current ? { ...current, [key]: saved[key] } : current
      )
    } catch {
      setSettings((current) =>
        current && previous !== undefined
          ? { ...current, [key]: previous }
          : current
      )
      setSaveError(SAVE_ERROR)
    } finally {
      setSavingKey(null)
    }
  }

  const loaded = settings !== null
  const altTextAvailable = settings?.altTextAvailable ?? false

  return (
    <div className="space-y-6">
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
          disabled={!loaded || !altTextAvailable || savingKey !== null}
          onCheckedChange={(checked) => handleToggle('autoDescribe', checked)}
        />

        <ToggleRow
          id="media-allow-empty-description"
          label="Allow posting media without a description"
          description="When off, every item needs a description or must be marked decorative."
          checked={settings?.allowEmptyDescription ?? false}
          disabled={!loaded || savingKey !== null}
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
          disabled={!loaded || savingKey !== null}
          onCheckedChange={(checked) =>
            handleToggle('subjectHashtags', checked)
          }
        />
      </section>

      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      )}
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      )}
    </div>
  )
}
