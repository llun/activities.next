'use client'

import Link from 'next/link'
import { FC } from 'react'

import {
  GallerySettingsStatus,
  ToggleRow,
  useGallerySettingsForm
} from '@/lib/components/settings/gallerySettingsForm'
import type { GallerySettings } from '@/lib/types/database/gallery'

type ToggleKey = keyof Pick<
  GallerySettings,
  'autoDescribe' | 'allowEmptyDescription' | 'subjectHashtags'
>

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

        <ToggleRow
          id="media-subject-hashtags"
          label="Add subjects as hashtags"
          description="Adds a hashtag such as #CommonKingfisher to the post for each subject."
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
