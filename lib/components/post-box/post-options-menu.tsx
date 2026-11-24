import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Eye,
  SlidersHorizontal
} from 'lucide-react'
import { FC, ReactNode, useId } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { QuoteApprovalPolicy } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

import {
  QUOTE_POLICY_OPTIONS,
  VISIBILITY_OPTIONS,
  VisibilityMenuOptions
} from './visibility-selector'

interface Props {
  /** Disables everything that changes what is posted, e.g. while submitting. */
  disabled?: boolean

  /** The fitness file item exists only for a new, non-reply post. */
  showFitnessFile: boolean
  onChooseFitnessFile: () => void

  pollShowing: boolean
  /** A quote post cannot carry a poll. */
  quoting: boolean
  /** Replying to a Bluesky post locks visibility to public and disables polls/CW. */
  blueskyReply?: boolean
  onTogglePoll: () => void

  visibility: MastodonVisibility
  onVisibilityChange: (visibility: MastodonVisibility) => void
  quotePolicy: QuoteApprovalPolicy
  onQuotePolicyChange: (policy: QuoteApprovalPolicy) => void

  contentWarningVisible: boolean
  onToggleContentWarning: () => void

  previewShowing: boolean
  onTogglePreview: () => void
}

const QUOTE_POLL_EXPLANATION = 'A quote post cannot include a poll'
const BLUESKY_POLL_EXPLANATION = 'Not supported on Bluesky replies'
const BLUESKY_CW_EXPLANATION = 'Not supported on Bluesky replies'
const BLUESKY_VISIBILITY_EXPLANATION = 'Bluesky replies are public'

// The submenu's width beside the menu on desktop; on a phone it opens inline.
const SUBMENU_WIDTH = 256

const ITEM_CLASS = 'min-h-10 cursor-pointer gap-3 md:min-h-9'

/**
 * A switch drawn inside a menu row. The row itself is the interactive
 * `menuitemcheckbox`, so this is deliberately not a `role="switch"` control:
 * nesting a second interactive element inside a menu item is invalid.
 */
const SwitchIndicator: FC<{ checked: boolean }> = ({ checked }) => (
  <span
    aria-hidden="true"
    data-state={checked ? 'checked' : 'unchecked'}
    className="ml-auto inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-sm border border-input bg-control-off transition-colors data-[state=checked]:bg-primary"
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

const MenuRowText: FC<{
  children: ReactNode
  description?: string
  labelId?: string
  descriptionId?: string
  /** Dims the label only, so a description beside it stays readable. */
  dimmed?: boolean
}> = ({ children, description, labelId, descriptionId, dimmed }) => (
  <span className="min-w-0 flex-1">
    <span id={labelId} className={cn('block', dimmed && 'opacity-50')}>
      {children}
    </span>
    {description ? (
      <span id={descriptionId} className="block text-xs text-muted-foreground">
        {description}
      </span>
    ) : null}
  </span>
)

/**
 * The composer's "Post options" button and menu: everything that shapes a post
 * beyond its text, photos and emoji, grouped behind one toolbar control so the
 * toolbar stays on a single line at every width.
 */
export const PostOptionsMenu: FC<Props> = ({
  disabled,
  showFitnessFile,
  onChooseFitnessFile,
  pollShowing,
  quoting,
  blueskyReply = false,
  onTogglePoll,
  visibility,
  onVisibilityChange,
  quotePolicy,
  onQuotePolicyChange,
  contentWarningVisible,
  onToggleContentWarning,
  previewShowing,
  onTogglePreview
}) => {
  const pollLabelId = useId()
  const pollDescriptionId = useId()
  const cwLabelId = useId()
  const cwDescriptionId = useId()
  const pollDisabledReason = blueskyReply
    ? BLUESKY_POLL_EXPLANATION
    : quoting
      ? QUOTE_POLL_EXPLANATION
      : undefined
  const active =
    (!blueskyReply && (pollShowing || contentWarningVisible)) || previewShowing
  const effectiveVisibility = blueskyReply ? 'public' : visibility
  const currentVisibility =
    VISIBILITY_OPTIONS.find((option) => option.value === effectiveVisibility) ??
    VISIBILITY_OPTIONS[0]
  const VisibilityIcon = currentVisibility.Icon
  // A restricted "who can quote" shows after the visibility as its own icon,
  // as the old toolbar pill did; the words are for assistive technology.
  const restrictedQuote =
    blueskyReply || quotePolicy === 'public'
      ? undefined
      : QUOTE_POLICY_OPTIONS.find((option) => option.value === quotePolicy)
  const RestrictedQuoteIcon = restrictedQuote?.Icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Post options"
          title="Post options"
          data-active={active ? 'true' : undefined}
          className={cn(
            'size-10 md:size-8',
            active
              ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <SlidersHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={16}
        className="w-72 max-w-[90vw]"
      >
        {showFitnessFile ? (
          <DropdownMenuItem
            disabled={disabled}
            onSelect={onChooseFitnessFile}
            className={ITEM_CLASS}
          >
            <Activity />
            <MenuRowText>Fitness file</MenuRowText>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={!blueskyReply && pollShowing}
          // A quote post or Bluesky reply cannot carry a poll, so the item is
          // disabled with an inline explanation.
          disabled={disabled || Boolean(pollDisabledReason)}
          // Name stays "Poll"; the explanation inside the row is only its
          // description.
          aria-labelledby={pollLabelId}
          aria-describedby={pollDisabledReason ? pollDescriptionId : undefined}
          onSelect={onTogglePoll}
          className={cn(
            ITEM_CLASS,
            // While disabled with a reason, only the icon and label dim: the
            // explanation is the part meant to be read.
            pollDisabledReason && 'data-[disabled]:opacity-100',
            !blueskyReply && pollShowing && 'text-primary-text'
          )}
        >
          <BarChart3
            className={cn(
              !blueskyReply && pollShowing && 'text-primary',
              pollDisabledReason && 'opacity-50'
            )}
          />
          <MenuRowText
            description={pollDisabledReason}
            labelId={pollLabelId}
            descriptionId={pollDescriptionId}
            dimmed={Boolean(pollDisabledReason)}
          >
            Poll
          </MenuRowText>
          {!blueskyReply && pollShowing ? (
            <Check className="ml-auto size-4 text-primary" />
          ) : null}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {blueskyReply ? (
          <DropdownMenuItem
            disabled
            className={cn(ITEM_CLASS, 'data-[disabled]:opacity-100')}
          >
            <VisibilityIcon className="opacity-50" />
            <MenuRowText description={BLUESKY_VISIBILITY_EXPLANATION} dimmed>
              Visibility
            </MenuRowText>
            <span className="ml-auto text-xs text-muted-foreground">
              {currentVisibility.label}
            </span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              disabled={disabled}
              className="min-h-10 cursor-pointer gap-3 md:min-h-9"
            >
              <VisibilityIcon />
              <span className="shrink-0">Visibility</span>{' '}
              <span className="flex min-w-0 flex-1 items-center justify-end gap-1 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">
                  {currentVisibility.label}
                </span>
                {RestrictedQuoteIcon ? (
                  <>
                    <RestrictedQuoteIcon
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-primary"
                    />
                    <span className="sr-only">
                      {' '}
                      {restrictedQuote?.label} can quote
                    </span>
                  </>
                ) : null}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              collisionPadding={16}
              style={{ width: SUBMENU_WIDTH }}
              className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto"
            >
              <VisibilityMenuOptions
                visibility={visibility}
                onVisibilityChange={onVisibilityChange}
                quotePolicy={quotePolicy}
                onQuotePolicyChange={onQuotePolicyChange}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={!blueskyReply && contentWarningVisible}
          disabled={disabled || blueskyReply}
          aria-labelledby={cwLabelId}
          aria-describedby={blueskyReply ? cwDescriptionId : undefined}
          // A toggle keeps the menu open so the effect is visible at once.
          onSelect={(event) => {
            event.preventDefault()
            onToggleContentWarning()
          }}
          className={cn(
            ITEM_CLASS,
            blueskyReply && 'data-[disabled]:opacity-100'
          )}
        >
          <AlertTriangle className={cn(blueskyReply && 'opacity-50')} />
          <MenuRowText
            description={blueskyReply ? BLUESKY_CW_EXPLANATION : undefined}
            labelId={cwLabelId}
            descriptionId={cwDescriptionId}
            dimmed={blueskyReply}
          >
            Content warning
          </MenuRowText>
          <SwitchIndicator checked={!blueskyReply && contentWarningVisible} />
        </DropdownMenuItem>
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={previewShowing}
          onSelect={(event) => {
            event.preventDefault()
            onTogglePreview()
          }}
          className={ITEM_CLASS}
        >
          <Eye />
          <MenuRowText>Preview</MenuRowText>
          <SwitchIndicator checked={previewShowing} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
