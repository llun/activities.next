'use client'

import Link from 'next/link'
import { FC, useMemo } from 'react'

import { ProfileFieldsBlock } from '@/lib/components/profile/ProfileFieldsBlock'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { cn } from '@/lib/utils'
import { formatProfileFieldValue } from '@/lib/utils/text/formatProfileFieldValue'

import type { ProfileDraft } from './profileDraft'

interface Props {
  draft: ProfileDraft
  username: string
  /** `@username@domain`. */
  handle: string
  /** Where "Fitness privacy" and "Gallery privacy" lead. */
  fitnessPrivacyHref?: string
  galleryPrivacyHref?: string
}

const TABS = [
  { key: 'showReplies', label: 'Replies' },
  { key: 'showMedia', label: 'Media' },
  { key: 'showGallery', label: 'Gallery' },
  { key: 'showFitness', label: 'Fitness' }
] as const

/**
 * The desktop column beside the editor: how the profile looks with what is in
 * the draft right now (avatar, header, name, handle, bio, the links on one line
 * with extras behind "+N more", and the tab strip), then the "Set in Settings"
 * card for the things this page does not edit. The card is inert, a picture of
 * the profile and not a second copy of its controls.
 */
export const ProfilePreview: FC<Props> = ({
  draft,
  username,
  handle,
  fitnessPrivacyHref = '/fitness/privacy',
  galleryPrivacyHref = '/gallery/privacy'
}) => {
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
  const tabs = [
    { key: 'posts', label: 'Posts' },
    ...TABS.filter((tab) => draft[tab.key])
  ]

  return (
    <aside aria-label="Preview" className="space-y-4">
      <div
        data-slot="profile-preview"
        // `inert`: a picture of the profile, so its "+N more" button and tabs
        // are neither focusable nor read out as a second set of controls.
        inert
        className="bg-background overflow-hidden rounded-lg border"
      >
        <div
          data-slot="profile-preview-header"
          className="bg-muted h-24 bg-cover bg-center"
          style={
            draft.headerImageUrl
              ? { backgroundImage: `url("${draft.headerImageUrl}")` }
              : undefined
          }
        />
        <div className="px-4 pb-0">
          <Avatar className="border-background -mt-9 size-[72px] border-4">
            {draft.iconUrl ? <AvatarImage src={draft.iconUrl} alt="" /> : null}
            <AvatarFallback className="text-[30px]">
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <p className="mt-2 text-lg leading-tight font-semibold break-words">
            {displayName}
          </p>
          <p className="text-muted-foreground text-sm break-all">{handle}</p>
          {draft.summary.trim() ? (
            <p
              data-slot="profile-preview-bio"
              className="mt-2 text-sm break-words whitespace-pre-line"
            >
              {draft.summary}
            </p>
          ) : null}
          <ProfileFieldsBlock fields={fields} />
        </div>
        <div
          data-slot="profile-preview-tabs"
          className="mt-3 flex gap-4 overflow-hidden border-t px-4 text-sm"
        >
          {tabs.map((tab, index) => (
            <span
              key={tab.key}
              className={cn(
                'border-b-2 py-2.5',
                index === 0
                  ? 'border-primary text-foreground font-medium'
                  : 'text-muted-foreground border-transparent'
              )}
            >
              {tab.label}
            </span>
          ))}
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Preview updates as you type. Other servers see the change after you
        save.
      </p>

      <nav
        aria-label="Set in Settings"
        className="bg-background rounded-lg border"
      >
        <p className="px-4 pt-3 text-sm font-semibold">Set in Settings</p>
        <ul className="mt-2 divide-y border-t">
          {[
            { label: 'Who can follow you', href: '/settings' },
            { label: 'Fitness privacy', href: fitnessPrivacyHref },
            { label: 'Gallery privacy', href: galleryPrivacyHref }
          ].map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="hover:bg-accent focus-visible:ring-ring/50 flex items-center justify-between px-4 py-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
              >
                {link.label}
                <span aria-hidden="true" className="text-muted-foreground">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
