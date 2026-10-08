'use client'

import Link from 'next/link'
import { FC } from 'react'

import {
  GallerySettingsStatus,
  ToggleRow,
  useGallerySettingsForm
} from '@/lib/components/settings/gallerySettingsForm'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import type { GallerySettings } from '@/lib/types/database/gallery'
import {
  MAX_SUBJECT_CONFIDENCE_THRESHOLD,
  MIN_SUBJECT_CONFIDENCE_THRESHOLD,
  SUBJECT_CONFIDENCE_THRESHOLD_STEP
} from '@/lib/types/database/gallery'

type ToggleKey = keyof Pick<
  GallerySettings,
  | 'autoDescribe'
  | 'allowEmptyDescription'
  | 'subjectHashtags'
  | 'subjectSuggestionMode'
  | 'subjectConfidenceThreshold'
>

const THRESHOLDS = Array.from(
  {
    length:
      (MAX_SUBJECT_CONFIDENCE_THRESHOLD - MIN_SUBJECT_CONFIDENCE_THRESHOLD) /
        SUBJECT_CONFIDENCE_THRESHOLD_STEP +
      1
  },
  (_, index) =>
    MIN_SUBJECT_CONFIDENCE_THRESHOLD + index * SUBJECT_CONFIDENCE_THRESHOLD_STEP
)

export const MediaDetailsSettings: FC = () => {
  const {
    settings,
    loaded,
    loadError,
    saveError,
    savedStatus,
    savingKeys,
    loadSettings,
    save: handleSave
  } = useGallerySettingsForm<ToggleKey>()

  const altTextAvailable = settings?.altTextAvailable ?? false
  const suggestionsAvailable = settings?.subjectSuggestionsAvailable ?? false
  // `classifier` is reserved and never offered: it reads as "model" here.
  const suggesting =
    suggestionsAvailable && settings?.subjectSuggestionMode === 'model'
  const modeBusy = savingKeys.has('subjectSuggestionMode')

  return (
    <div className="space-y-6">
      <GallerySettingsStatus
        loadError={loadError}
        saveError={saveError}
        savedStatus={savedStatus}
        onRetry={loadSettings}
      />

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
          disabled={!loaded || !altTextAvailable}
          busy={savingKeys.has('autoDescribe')}
          onCheckedChange={(checked) => handleSave('autoDescribe', checked)}
        />

        <ToggleRow
          id="media-allow-empty-description"
          label="Allow posting media without a description"
          description="When off, every item needs a description or must be marked decorative."
          checked={settings?.allowEmptyDescription ?? false}
          disabled={!loaded}
          busy={savingKeys.has('allowEmptyDescription')}
          onCheckedChange={(checked) =>
            handleSave('allowEmptyDescription', checked)
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

        <fieldset
          className="m-0 space-y-2 border-0 p-0"
          aria-busy={modeBusy}
          disabled={!loaded}
        >
          <legend className="pb-1 text-sm font-medium">
            Suggest subjects with
          </legend>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="media-subject-mode"
              className="mt-0.5 size-4 accent-primary"
              checked={suggesting}
              disabled={!loaded || !suggestionsAvailable}
              onChange={() => handleSave('subjectSuggestionMode', 'model')}
            />
            <span className="space-y-0.5">
              <span className="block">
                Server image model
                {settings?.subjectModel ? ` · ${settings.subjectModel}` : ''}
              </span>
              {loaded && !suggestionsAvailable ? (
                <span className="block text-[0.8rem] text-muted-foreground">
                  Your server has no image model set up.
                </span>
              ) : (
                <span className="block text-[0.8rem] text-muted-foreground">
                  Same model as descriptions. Good at any subject; species names
                  are checked against GBIF.
                </span>
              )}
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="media-subject-mode"
              className="mt-0.5 size-4 accent-primary"
              checked={loaded && !suggesting}
              disabled={!loaded}
              onChange={() => handleSave('subjectSuggestionMode', 'off')}
            />
            <span>Don’t suggest</span>
          </label>
        </fieldset>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="media-subject-threshold">
              Name a species only when at least
            </Label>
            <p className="text-[0.8rem] text-muted-foreground">
              Below this, the suggestion is the group, like “Bird?”.
            </p>
          </div>
          <Select
            id="media-subject-threshold"
            className="w-24 shrink-0"
            aria-busy={savingKeys.has('subjectConfidenceThreshold')}
            value={settings?.subjectConfidenceThreshold ?? 70}
            disabled={!loaded || !suggesting}
            onChange={(event) =>
              handleSave(
                'subjectConfidenceThreshold',
                Number(event.target.value)
              )
            }
          >
            {THRESHOLDS.map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </Select>
        </div>

        <ToggleRow
          id="media-subject-hashtags"
          label="Add subjects as hashtags"
          description="Adds hashtags such as #CommonKingfisher #AlcedoAtthis to the post for each subject."
          checked={settings?.subjectHashtags ?? false}
          disabled={!loaded}
          busy={savingKeys.has('subjectHashtags')}
          onCheckedChange={(checked) => handleSave('subjectHashtags', checked)}
        />
      </section>

      <p className="text-sm text-muted-foreground">
        Place privacy, map and gear settings are in{' '}
        <Link href="/gallery/privacy" className="underline">
          Gallery privacy
        </Link>{' '}
        and{' '}
        <Link href="/gallery/gear" className="underline">
          Gallery gear
        </Link>
        .
      </p>
    </div>
  )
}
