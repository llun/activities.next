'use client'

import { Share2 } from 'lucide-react'
import { FC, useId } from 'react'

import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { Status, StatusType, isBlueskyStatus } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import {
  BLUESKY_CROSSPOST_CUT_MESSAGE,
  isOverBlueskyLimit
} from '@/lib/utils/blueskyText'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

export const BLUESKY_CROSSPOST_LABEL = 'Also post to Bluesky'
export const BLUESKY_CROSSPOST_PUBLIC_ONLY_REASON =
  'Only public posts go to Bluesky.'

// The post's own id is minted at submit, so a 36-character UUIDv7 placeholder
// stands in for it (only its length matters for the cut check).
const PLACEHOLDER_STATUS_ID = '0'.repeat(36)

const getPlaceholderPostUrl = (profile: ActorProfile): string =>
  `https://${profile.domain}/${getMention(profile)}/${PLACEHOLDER_STATUS_ID}`

/**
 * Whether the Bluesky copy of a cross-posted status will be cut.
 *
 * Mirrors `buildRecord` / `buildCrosspostText`:
 * - When a content warning is on and non-empty, Bluesky gets only the warning
 *   text plus the post's link (never the body, poll link, or quoted link).
 * - Otherwise Bluesky gets the body, plus `Vote here: <url>` for a poll or the
 *   quoted status URL for a fediverse quote.
 */
export const isBlueskyCrosspostCut = ({
  enabled,
  visibility,
  text,
  contentWarningVisible,
  contentWarning,
  profile,
  isPoll = false,
  quotedStatus
}: {
  enabled: boolean
  visibility: MastodonVisibility
  text: string
  contentWarningVisible: boolean
  contentWarning: string
  profile: ActorProfile
  isPoll?: boolean
  quotedStatus?: Status
}): boolean => {
  if (!enabled || visibility !== 'public') return false

  const trimmedContentWarning = contentWarningVisible
    ? contentWarning.trim()
    : ''
  if (trimmedContentWarning) {
    return isOverBlueskyLimit(
      trimmedContentWarning,
      getPlaceholderPostUrl(profile)
    )
  }

  const appendedLink = isPoll
    ? `Vote here: ${getPlaceholderPostUrl(profile)}`
    : quotedStatus &&
        !isBlueskyStatus(quotedStatus) &&
        quotedStatus.type !== StatusType.enum.Announce
      ? quotedStatus.url
      : null

  return isOverBlueskyLimit(text, appendedLink)
}

/**
 * A purely visual switch indicator shared between menu items (`menuitemcheckbox`)
 * and inline switch controls (`role="switch"`).
 */
export const SwitchIndicator: FC<{ checked: boolean; className?: string }> = ({
  checked,
  className
}) => (
  <span
    aria-hidden="true"
    data-state={checked ? 'checked' : 'unchecked'}
    className={cn(
      'inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-sm border border-input bg-control-off transition-colors data-[state=checked]:bg-primary',
      className
    )}
  >
    <span
      className={cn(
        'block size-4 rounded-[1px] bg-background transition-transform dark:bg-foreground',
        checked
          ? 'translate-x-[calc(100%-2px)] dark:bg-primary-foreground'
          : 'translate-x-0'
      )}
    />
  </span>
)

/**
 * Inline "Also post to Bluesky" switch used in compact composers without a
 * Post options menu (`StatusReplyBox`), reusing `SwitchIndicator`.
 */
export const BlueskyCrosspostSwitch: FC<{
  checked: boolean
  disabled?: boolean
  disabledReason?: string
  onToggle: () => void
}> = ({ checked, disabled, disabledReason, onToggle }) => {
  const labelId = useId()
  const descriptionId = useId()
  const effectiveChecked = checked && !disabledReason
  const isDisabled = Boolean(disabled || disabledReason)

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={effectiveChecked}
        aria-labelledby={labelId}
        aria-describedby={disabledReason ? descriptionId : undefined}
        disabled={isDisabled}
        title={disabledReason}
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)] disabled:cursor-not-allowed"
      >
        <Share2
          aria-hidden="true"
          className={cn('size-3.5 shrink-0', isDisabled && 'opacity-50')}
        />
        <span id={labelId} className={cn(isDisabled && 'opacity-50')}>
          {BLUESKY_CROSSPOST_LABEL}
        </span>
        <SwitchIndicator
          checked={effectiveChecked}
          className={cn(isDisabled && 'opacity-50')}
        />
      </button>
      {disabledReason ? (
        <span id={descriptionId} className="text-xs text-muted-foreground">
          {disabledReason}
        </span>
      ) : null}
    </div>
  )
}

/** Non-blocking warning shown beside the counter when the Bluesky copy is cut. */
export const BlueskyCrosspostCutNotice: FC<{ show: boolean }> = ({ show }) =>
  show ? (
    <span role="status" className="text-xs text-warning-text">
      {BLUESKY_CROSSPOST_CUT_MESSAGE}
    </span>
  ) : null
