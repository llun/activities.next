'use client'

import { FC, useId, useMemo } from 'react'

import { ProfileCover } from '@/app/(timeline)/[actor]/ProfileCover'
import { ProfileHeaderImage } from '@/app/(timeline)/[actor]/ProfileHeaderImage'
import {
  ActorDisplayName,
  type CustomEmojiTextProps
} from '@/lib/components/actors/ActorDisplayName'
import {
  ProfileHeaderBlock,
  getInitials
} from '@/lib/components/profile/ProfileHeaderBlock'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import {
  PROFILE_TAB_LABELS,
  type ProfileTabContent,
  getAvailableProfileTabs
} from '@/lib/types/domain/profileTabs'
import { formatProfileFieldValue } from '@/lib/utils/text/formatProfileFieldValue'

import type { ProfileDraft } from './profileDraft'

interface Props {
  draft: ProfileDraft
  actorId: string
  username: string
  /** `@username@domain`. */
  handle: string
  /** The actor's custom emoji, so the name and links show shortcodes as images. */
  tags?: CustomEmojiTextProps['tags']
  /** What there is behind each optional tab, so the strip matches the profile. */
  tabContent: ProfileTabContent
}

/**
 * The profile header at real size, above the editor's form: the same cover,
 * avatar, name, handle, bio, links and tab strip the profile page draws, from
 * the draft as it is right now. Inert, a picture of the profile and not a
 * second copy of its controls.
 */
export const ProfilePreview: FC<Props> = ({
  draft,
  actorId,
  username,
  handle,
  tags,
  tabContent
}) => {
  const captionId = useId()
  const fields = useMemo(
    () =>
      draft.fields
        .filter((field) => field.name.trim() && field.value.trim())
        .map((field) => ({
          name: field.name.trim(),
          value: formatProfileFieldValue(field.value)
        })),
    [draft.fields]
  )
  const displayName = draft.name.trim() || username
  const tabs = getAvailableProfileTabs({
    tabVisibility: {
      replies: draft.showReplies,
      media: draft.showMedia,
      gallery: draft.showGallery,
      fitness: draft.showFitness
    },
    isInternalAccount: true,
    content: tabContent
  })

  return (
    <section aria-labelledby={captionId} className="space-y-2">
      <p
        id={captionId}
        className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide"
      >
        <span aria-hidden="true" className="bg-primary size-1.5 rounded-full" />
        Live preview · updates as you type
      </p>
      <p className="text-muted-foreground text-xs">
        Other servers see changes after you save.
      </p>

      <div
        data-slot="profile-preview"
        // `inert`: a picture of the profile, so its "+N more" button and tabs
        // are neither focusable nor read out as a second set of controls.
        inert
        // From `md` up a bordered card, so it reads as a preview and not as
        // part of the form; below `md` the cover runs full-bleed like the
        // profile on a phone.
        className="md:rounded-lg md:border md:pb-4"
      >
        <ProfileHeaderBlock
          cover={
            <ProfileCover className="md:rounded-b-none">
              <ProfileHeaderImage
                actorId={actorId}
                imageUrl={draft.headerImageUrl}
                mediaType={null}
              />
            </ProfileCover>
          }
          avatarUrl={draft.iconUrl}
          avatarAlt=""
          initials={getInitials(draft.name, username)}
          nameAs="p"
          name={<ActorDisplayName name={displayName} tags={tags} />}
          handle={<span className="block truncate">{handle}</span>}
          summary={draft.summary}
          fields={fields}
          tags={tags}
        />

        {tabs.length > 1 ? (
          <div className="px-4 pt-3">
            <SegmentedControl
              aria-label="Profile sections"
              items={tabs.map((value) => ({
                value,
                label: PROFILE_TAB_LABELS[value]
              }))}
              value="posts"
              onValueChange={() => {}}
              className="sm:w-fit"
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
