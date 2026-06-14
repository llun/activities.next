'use client'

import { FC, useMemo, useState } from 'react'

import { PreferencesInput, updatePreferences } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Label } from '@/lib/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import { cn } from '@/lib/utils'

type PostingVisibility = PreferencesInput['visibility']
type ExpandMedia = PreferencesInput['expandMedia']

const VISIBILITIES: { value: PostingVisibility; label: string }[] = [
  { value: 'public', label: 'Public — visible to everyone' },
  {
    value: 'unlisted',
    label: 'Unlisted — public, but out of trends and search'
  },
  { value: 'private', label: 'Followers only' }
]

const LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'th', label: 'ไทย' },
  { value: 'ja', label: '日本語' },
  { value: 'fr', label: 'Français' }
]

const MEDIA_DISPLAY: { value: ExpandMedia; label: string; help: string }[] = [
  {
    value: 'default',
    label: 'Hide media marked as sensitive',
    help: 'The default — click to reveal.'
  },
  {
    value: 'show_all',
    label: 'Show all media',
    help: 'Including media marked as sensitive.'
  },
  {
    value: 'hide_all',
    label: 'Hide all media',
    help: 'Every attachment needs a click to show.'
  }
]

// A label/description on the left with its control on the right.
interface ControlRowProps {
  label: string
  description?: string
  htmlFor?: string
  children: React.ReactNode
}

const ControlRow: FC<ControlRowProps> = ({
  label,
  description,
  htmlFor,
  children
}) => (
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0 space-y-0.5">
      <Label htmlFor={htmlFor} className="cursor-pointer">
        {label}
      </Label>
      {description && (
        <p className="text-[0.8rem] text-muted-foreground">{description}</p>
      )}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)

interface Props {
  initialPreferences: PreferencesInput
}

export const PreferencesSettings: FC<Props> = ({ initialPreferences }) => {
  const [preferences, setPreferences] =
    useState<PreferencesInput>(initialPreferences)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = useMemo(
    () =>
      (Object.keys(preferences) as (keyof PreferencesInput)[]).some(
        (key) => preferences[key] !== initialPreferences[key]
      ),
    [preferences, initialPreferences]
  )

  const update = <K extends keyof PreferencesInput>(
    key: K,
    value: PreferencesInput[K]
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }))
    setSaved(false)
    setError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const ok = await updatePreferences(preferences)
      if (ok) {
        setSaved(true)
      } else {
        setError('Failed to save preferences. Please try again.')
      }
    } catch {
      setError('Failed to save preferences. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preferences"
        description="Defaults for what you post and how your timeline reads. Apps using the Mastodon API pick these up automatically."
      />

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Posting defaults</h2>
          <p className="text-sm text-muted-foreground">
            Applied to every new post; you can still change them per post in the
            composer.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="posting-visibility">Posting privacy</Label>
          <Select
            id="posting-visibility"
            value={preferences.visibility}
            onChange={(event) =>
              update('visibility', event.target.value as PostingVisibility)
            }
          >
            {VISIBILITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="posting-language">Posting language</Label>
          <Select
            id="posting-language"
            value={preferences.language}
            onChange={(event) => update('language', event.target.value)}
          >
            {LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <p className="text-[0.8rem] text-muted-foreground">
            Lets readers filter public timelines by languages they understand.
          </p>
        </div>

        <ControlRow
          label="Mark media as sensitive by default"
          description="Every attachment starts hidden behind the sensitive overlay."
          htmlFor="posting-sensitive"
        >
          <Switch
            id="posting-sensitive"
            checked={preferences.sensitive}
            onCheckedChange={(checked) => update('sensitive', checked)}
          />
        </ControlRow>
      </section>

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Reading</h2>
          <p className="text-sm text-muted-foreground">
            How posts from other people display for you.
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Media display</div>
          <RadioGroup
            value={preferences.expandMedia}
            onValueChange={(value) =>
              update('expandMedia', value as ExpandMedia)
            }
            className="gap-0 overflow-hidden rounded-xl border"
          >
            {MEDIA_DISPLAY.map((option, index) => {
              const active = preferences.expandMedia === option.value
              return (
                <Label
                  key={option.value}
                  htmlFor={`media-${option.value}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 px-4 py-3 font-normal transition-colors hover:bg-muted/50',
                    index > 0 && 'border-t',
                    active && 'bg-primary/5'
                  )}
                >
                  <RadioGroupItem
                    id={`media-${option.value}`}
                    value={option.value}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {option.label}
                    </span>
                    <span className="block text-[0.8rem] text-muted-foreground">
                      {option.help}
                    </span>
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
        </div>

        <ControlRow
          label="Always expand posts marked with content warnings"
          description="Skip the “show more” click on CW posts."
          htmlFor="reading-spoilers"
        >
          <Switch
            id="reading-spoilers"
            checked={preferences.expandSpoilers}
            onCheckedChange={(checked) => update('expandSpoilers', checked)}
          />
        </ControlRow>

        <ControlRow
          label="Autoplay animated GIFs"
          description="Off plays them only on hover or tap."
          htmlFor="reading-gifs"
        >
          <Switch
            id="reading-gifs"
            checked={preferences.autoplayGifs}
            onCheckedChange={(checked) => update('autoplayGifs', checked)}
          />
        </ControlRow>
      </section>

      <div className="flex items-center justify-end gap-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && saved && (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
            Saved
          </span>
        )}
        {!error && !saved && dirty && (
          <span className="text-sm text-muted-foreground">Unsaved changes</span>
        )}
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
