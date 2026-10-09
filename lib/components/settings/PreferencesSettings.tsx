'use client'

import { FC, useMemo, useState } from 'react'

import { PreferencesInput, updatePreferences } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { usePlaybackPreferences } from '@/lib/components/preferences/PlaybackPreferencesContext'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { Label } from '@/lib/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'

type PostingVisibility = PreferencesInput['visibility']
type QuotePolicy = PreferencesInput['quotePolicy']
type ExpandMedia = PreferencesInput['expandMedia']

const VISIBILITIES: { value: PostingVisibility; label: string }[] = [
  { value: 'public', label: 'Public — visible to everyone' },
  {
    value: 'unlisted',
    label: 'Unlisted — public, but out of trends and search'
  },
  { value: 'private', label: 'Followers only' },
  // `direct` is not a typical default, but the account model allows it (e.g. set
  // by a Mastodon client). Listing it keeps the select from silently rewriting a
  // stored `direct` default to a different value on save.
  { value: 'direct', label: 'Direct — only people mentioned' }
]

const QUOTE_POLICIES: { value: QuotePolicy; label: string }[] = [
  { value: 'public', label: 'Anyone can quote' },
  { value: 'followers', label: 'Followers can quote' },
  { value: 'nobody', label: 'No one can quote' }
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

interface Props {
  initialPreferences: PreferencesInput
}

export const PreferencesSettings: FC<Props> = ({ initialPreferences }) => {
  const { setAutoplayGifs } = usePlaybackPreferences()
  // The baseline the form diffs against. Tracked in state (seeded from the
  // server prop) so a successful save can reset it — otherwise the form would
  // stay "dirty" against the immutable prop and keep Save enabled.
  const [savedPreferences, setSavedPreferences] =
    useState<PreferencesInput>(initialPreferences)
  const [preferences, setPreferences] =
    useState<PreferencesInput>(initialPreferences)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = useMemo(
    () =>
      (Object.keys(preferences) as (keyof PreferencesInput)[]).some(
        (key) => preferences[key] !== savedPreferences[key]
      ),
    [preferences, savedPreferences]
  )

  // `defaultLanguage` is an arbitrary string in actor settings, so the stored
  // value may not be in the curated list. Keep it selectable to avoid the
  // select rendering blank and silently overwriting it on save.
  const languageOptions = useMemo(() => {
    if (
      LANGUAGES.some((option) => option.value === initialPreferences.language)
    )
      return LANGUAGES
    return [
      {
        value: initialPreferences.language,
        label: initialPreferences.language
      },
      ...LANGUAGES
    ]
  }, [initialPreferences.language])

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
        setSavedPreferences(preferences)
        setAutoplayGifs(preferences.autoplayGifs)
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

      <Section
        title="Posting defaults"
        description="Applied to every new post; you can still change them per post in the composer."
      >
        <Frame divided>
          <FormRow label="Posting privacy" htmlFor="posting-visibility">
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
          </FormRow>

          <FormRow
            label="Who can quote"
            htmlFor="posting-quote-policy"
            hint="Applies to new public and unlisted posts; quotes of restricted posts always need your approval."
          >
            {({ describedBy }) => (
              <Select
                id="posting-quote-policy"
                aria-describedby={describedBy}
                value={preferences.quotePolicy}
                onChange={(event) =>
                  update('quotePolicy', event.target.value as QuotePolicy)
                }
              >
                {QUOTE_POLICIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </FormRow>

          <FormRow
            label="Posting language"
            htmlFor="posting-language"
            hint="Lets readers filter public timelines by languages they understand."
          >
            {({ describedBy }) => (
              <Select
                id="posting-language"
                aria-describedby={describedBy}
                value={preferences.language}
                onChange={(event) => update('language', event.target.value)}
              >
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </FormRow>

          <FormRow
            label="Mark media as sensitive by default"
            htmlFor="posting-sensitive"
            hint="Every attachment starts hidden behind the sensitive overlay."
            inline
          >
            {({ describedBy }) => (
              <Switch
                id="posting-sensitive"
                aria-describedby={describedBy}
                checked={preferences.sensitive}
                onCheckedChange={(checked) => update('sensitive', checked)}
              />
            )}
          </FormRow>
        </Frame>
      </Section>

      <Section
        title="Reading"
        description="How posts from other people display for you."
      >
        <Frame divided>
          <FormRow label="Media display">
            {({ labelledBy }) => (
              <RadioGroup
                aria-labelledby={labelledBy}
                value={preferences.expandMedia}
                onValueChange={(value) =>
                  update('expandMedia', value as ExpandMedia)
                }
                className="gap-1"
              >
                {MEDIA_DISPLAY.map((option) => (
                  <div
                    key={option.value}
                    className="hover:bg-muted/50 flex items-start gap-3 rounded-md px-2 py-2 transition-colors"
                  >
                    <RadioGroupItem
                      id={`media-${option.value}`}
                      value={option.value}
                      className="mt-0.5"
                    />
                    {/* The shared Label is a flex ROW (it lays an icon beside
                        its text), which would put the title and the helper side
                        by side; this one stacks them. */}
                    <Label
                      htmlFor={`media-${option.value}`}
                      className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-px font-normal"
                    >
                      <span className="block text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {option.help}
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          </FormRow>

          <FormRow
            label="Always expand posts marked with content warnings"
            htmlFor="reading-spoilers"
            hint="Skip the “show more” click on CW posts."
            inline
          >
            {({ describedBy }) => (
              <Switch
                id="reading-spoilers"
                aria-describedby={describedBy}
                checked={preferences.expandSpoilers}
                onCheckedChange={(checked) => update('expandSpoilers', checked)}
              />
            )}
          </FormRow>

          <FormRow
            label="Autoplay animated GIFs"
            htmlFor="reading-gifs"
            hint="Off keeps GIFs paused until you choose to play them."
            inline
          >
            {({ describedBy }) => (
              <Switch
                id="reading-gifs"
                aria-describedby={describedBy}
                checked={preferences.autoplayGifs}
                onCheckedChange={(checked) => update('autoplayGifs', checked)}
              />
            )}
          </FormRow>
        </Frame>
      </Section>

      <Frame className="px-4 py-3">
        {/* Dirty wins over "Saved": if the user edits again (even while a save
            is in flight) the bar must not claim the form is saved. */}
        <SaveBar
          dirty={dirty}
          saving={saving}
          saved={saved}
          error={error}
          onSave={handleSave}
        />
      </Frame>
    </div>
  )
}
