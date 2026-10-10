import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Eye,
  SlidersHorizontal
} from 'lucide-react'
import { FC, ReactNode, useSyncExternalStore } from 'react'

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

export const QUOTE_POLL_EXPLANATION = 'A quote post cannot include a poll'

// Tailwind's `md` breakpoint: below it the menu is too narrow to open a
// submenu beside itself.
const PHONE_QUERY = '(max-width: 767px)'

const subscribeToPhoneQuery = (onChange: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const isPhoneViewport = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia(PHONE_QUERY).matches

const useIsPhoneViewport = () =>
  useSyncExternalStore(subscribeToPhoneQuery, isPhoneViewport, () => false)

// The menu is `w-72` (288px) and the submenu `w-64` (256px): a submenu pulled
// back by 264px ends 8px inside the menu's right edge.
const PHONE_SUBMENU_OFFSET = -264

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
    className="ml-auto inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full bg-control-off transition-colors data-[state=checked]:bg-primary"
  >
    <span
      className={cn(
        'block size-4 rounded-full bg-background shadow-xs transition-transform dark:bg-foreground',
        checked
          ? 'translate-x-[calc(100%-2px)] dark:bg-primary-foreground'
          : 'translate-x-0'
      )}
    />
  </span>
)

const MenuRowText: FC<{ children: ReactNode; description?: string }> = ({
  children,
  description
}) => (
  <span className="min-w-0 flex-1">
    <span className="block">{children}</span>
    {description ? (
      <span className="block text-xs text-muted-foreground">{description}</span>
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
  const isPhone = useIsPhoneViewport()
  const active = pollShowing || contentWarningVisible || previewShowing
  const currentVisibility =
    VISIBILITY_OPTIONS.find((option) => option.value === visibility) ??
    VISIBILITY_OPTIONS[0]
  const VisibilityIcon = currentVisibility.Icon

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
          aria-checked={pollShowing}
          // A quote post cannot carry a poll (they are mutually exclusive,
          // like media), so the item is disabled while quoting.
          disabled={disabled || quoting}
          onSelect={onTogglePoll}
          className={cn(
            ITEM_CLASS,
            pollShowing && 'text-primary-text [&_svg]:text-primary'
          )}
        >
          <BarChart3 />
          <MenuRowText
            description={quoting ? QUOTE_POLL_EXPLANATION : undefined}
          >
            Poll
          </MenuRowText>
          {pollShowing ? (
            <Check className="ml-auto size-4 text-primary" />
          ) : null}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={disabled}
            className="min-h-10 cursor-pointer gap-3 md:min-h-9"
          >
            <VisibilityIcon />
            <span className="min-w-0 flex-1">Visibility</span>{' '}
            <span className="text-xs text-muted-foreground">
              {currentVisibility.label}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            // Beside the menu on desktop. A phone has no room for two menus
            // side by side, so there the submenu is pulled back over its
            // parent (still on the right side, so it cannot flip off-screen):
            // its left edge sits inside the menu and its right edge stays
            // 8px short of the menu's, whatever the menu's own position.
            sideOffset={isPhone ? PHONE_SUBMENU_OFFSET : undefined}
            collisionPadding={16}
            className="w-64"
          >
            <VisibilityMenuOptions
              visibility={visibility}
              onVisibilityChange={onVisibilityChange}
              quotePolicy={quotePolicy}
              onQuotePolicyChange={onQuotePolicyChange}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={contentWarningVisible}
          disabled={disabled}
          // A toggle keeps the menu open so the effect is visible at once.
          onSelect={(event) => {
            event.preventDefault()
            onToggleContentWarning()
          }}
          className={ITEM_CLASS}
        >
          <AlertTriangle />
          <MenuRowText>Content warning</MenuRowText>
          <SwitchIndicator checked={contentWarningVisible} />
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
