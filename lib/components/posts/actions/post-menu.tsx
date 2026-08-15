'use client'

import {
  AtSign,
  Ban,
  Check,
  ExternalLink,
  Globe,
  Link as LinkIcon,
  Lock,
  Mail,
  MessageSquareQuote,
  MoreHorizontal,
  Pencil,
  Trash2,
  TriangleAlert,
  Unlock,
  Users,
  VolumeX
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, ReactNode, RefObject, useEffect, useRef, useState } from 'react'

import {
  getRelationship,
  unblock,
  unmute,
  updateStatusInteractionPolicy,
  updateStatusVisibility
} from '@/lib/client'
import { getActorIdMention } from '@/lib/components/posts/actor'
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
import { getEffectiveQuoteApprovalPolicy } from '@/lib/services/quotes/quotePolicy'
import {
  EditableStatus,
  QuoteApprovalPolicy,
  Status,
  StatusNote,
  StatusPoll
} from '@/lib/types/domain/status'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'
import { cn } from '@/lib/utils'
import { MastodonVisibility, getVisibility } from '@/lib/utils/getVisibility'

import {
  BlockDialog,
  DeleteDialog,
  MuteDialog,
  ReportDialog
} from './post-menu-dialogs'

const VISIBILITY_OPTIONS: {
  value: MastodonVisibility
  label: string
  icon: ReactNode
}[] = [
  { value: 'public', label: 'Public', icon: <Globe className="size-4" /> },
  { value: 'unlisted', label: 'Unlisted', icon: <Unlock className="size-4" /> },
  {
    value: 'private',
    label: 'Followers only',
    icon: <Lock className="size-4" />
  },
  { value: 'direct', label: 'Direct', icon: <Mail className="size-4" /> }
]

const QUOTE_POLICY_OPTIONS: {
  value: QuoteApprovalPolicy
  label: string
  icon: ReactNode
}[] = [
  { value: 'public', label: 'Anyone', icon: <Globe className="size-4" /> },
  {
    value: 'followers',
    label: 'Followers',
    icon: <Users className="size-4" />
  },
  { value: 'nobody', label: 'No one', icon: <Ban className="size-4" /> }
]

type ActiveDialog = 'mute' | 'block' | 'report' | 'delete' | null

/**
 * One choice inside a `PostMenuExtraItem`'s submenu — a pick-one list, so it
 * carries `checked` rather than a pressed state. `trailing` is the muted value
 * shown at the row's right edge (a gear's lifetime distance, say), which is
 * what tells two similarly-named entries apart at a glance.
 */
export interface PostMenuExtraSubItem {
  key: string
  label: string
  checked: boolean
  trailing?: string
  disabled?: boolean
  /** Renders the label muted — for a "none of them" row. */
  muted?: boolean
  onSelect: () => void
}

interface PostMenuExtraItemBase {
  key: string
  icon: ReactNode
  label: string
  /**
   * A menu item has none of the busy styling the button it replaces had, so an
   * action whose own write is in flight has to say so here instead.
   */
  disabled?: boolean
}

/** An extra item that runs one action. */
export interface PostMenuExtraActionItem extends PostMenuExtraItemBase {
  items?: never
  onSelect: () => void
  /**
   * Run the action once the menu has fully closed, and let it keep focus.
   * Radix restores focus to the ⋯ trigger as the menu unmounts, which would
   * otherwise land *after* an overlay's own autofocus and steal it back.
   */
  deferUntilClosed?: boolean
}

/**
 * An extra item that opens a submenu of choices, built on the same
 * `DropdownMenuSub` as "Change visibility" below. The two shapes are a union
 * rather than one type with optional halves so that a submenu with a stray
 * `onSelect` — an action that would never run, since a submenu trigger only
 * opens its submenu — is a type error instead of dead code.
 */
export interface PostMenuExtraSubmenuItem extends PostMenuExtraItemBase {
  items: PostMenuExtraSubItem[]
  onSelect?: never
  deferUntilClosed?: never
}

/**
 * An action the row could not fit and handed to the menu (bookmark, react), or
 * one a surface adds for a post only it knows about (the fitness activity
 * detail's "Change gear"). They render above the menu's own items, matching the
 * design system.
 *
 * This can only ADD to the action set — there is deliberately no way to remove
 * or replace one of the menu's own items, because a post offers the same
 * actions on every surface (see **Status Posts & Actions** in AGENTS.md).
 */
export type PostMenuExtraItem =
  PostMenuExtraActionItem | PostMenuExtraSubmenuItem

interface Props {
  // Always the resolved note/poll (Announce statuses are unwrapped by the
  // caller), so url / to / cc are always present.
  status: StatusNote | StatusPoll
  isOwner: boolean
  canEdit: boolean
  /**
   * Lets the caller anchor an overlay to the ⋯ trigger — the reaction picker
   * uses it when the row is compact and the picker is opened from this menu.
   */
  triggerRef?: RefObject<HTMLButtonElement | null>
  extraItems?: PostMenuExtraItem[]
  /** Layout classes from the row that owns the menu (e.g. `ml-auto`). */
  className?: string
  onReply?: (status: Status) => void
  onEdit?: (status: EditableStatus) => void
  onQuote?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
}

// Responsive "more actions" (⋯) overflow menu shown at the end of a post's
// action row. Own posts get authoring actions (Edit · Change visibility · Copy
// link · Delete); other actors' posts get relationship actions (Mention · Mute
// · Block · Copy link · Open original · Report). Built on the shared Radix
// DropdownMenu, which portals to the body and handles Escape / outside-click,
// so it renders an anchored popover on every breakpoint (matching the design
// system's section dropdowns). Confirmation dialogs live in ./post-menu-dialogs.
export const PostMenu: FC<Props> = ({
  status,
  isOwner,
  canEdit,
  triggerRef,
  extraItems,
  className,
  onReply,
  onEdit,
  onQuote,
  onPostDeleted
}) => {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const deferredSelectRef = useRef<(() => void) | null>(null)
  const [dialog, setDialog] = useState<ActiveDialog>(null)
  const [relationship, setRelationship] = useState<MastodonRelationship | null>(
    null
  )
  const [relationshipLoaded, setRelationshipLoaded] = useState(false)
  const [copied, setCopied] = useState(false)
  // Failure feedback for the direct (non-dialog) menu actions — unmute,
  // unblock, change visibility — which close the menu and so have no dialog to
  // surface an error in. Auto-dismisses.
  const [actionError, setActionError] = useState<string | null>(null)

  const targetActorId = status.actorId
  const actorName =
    status.actor?.name ||
    status.actor?.username ||
    getActorIdMention(status.actorId, status.url)
  const mention = getActorIdMention(status.actorId, status.url)
  const statusUrl = status.url || status.id
  const showOpenOriginal = !status.isLocalActor && Boolean(statusUrl)

  const [visibility, setVisibility] = useState<MastodonVisibility>(
    getVisibility(status.to, status.cc)
  )
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const [quotePolicy, setQuotePolicy] = useState<QuoteApprovalPolicy>(
    getEffectiveQuoteApprovalPolicy(status)
  )
  const [quotePolicySaving, setQuotePolicySaving] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeoutId = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timeoutId)
  }, [copied])

  useEffect(() => {
    if (!actionError) return
    const timeoutId = setTimeout(() => setActionError(null), 4000)
    return () => clearTimeout(timeoutId)
  }, [actionError])

  const loadRelationship = async () => {
    if (isOwner || relationshipLoaded) return
    try {
      const next = await getRelationship({ targetActorId })
      if (next) {
        setRelationship(next)
        // Only mark as loaded once we actually have a relationship, so a failed
        // fetch retries on the next open instead of leaving the menu showing the
        // wrong Mute/Block (vs. Unmute/Unblock) state forever.
        setRelationshipLoaded(true)
      }
    } catch {
      // Leave relationshipLoaded false so the next menu open retries.
    }
  }

  const copyLink = async () => {
    // navigator.clipboard is undefined in non-secure (HTTP) contexts.
    if (!navigator.clipboard) {
      setActionError('Copying links requires a secure (HTTPS) connection.')
      return
    }
    try {
      await navigator.clipboard.writeText(statusUrl)
      setCopied(true)
    } catch {
      setActionError("Couldn't copy the link. Please try again.")
    }
  }

  const handleVisibilityChange = async (next: MastodonVisibility) => {
    if (next === visibility || visibilitySaving) return
    const previous = visibility
    setVisibility(next)
    setVisibilitySaving(true)
    setActionError(null)
    const success = await updateStatusVisibility({
      statusId: status.id,
      visibility: next
    })
    setVisibilitySaving(false)
    if (!success) {
      setVisibility(previous)
      setActionError("Couldn't change post visibility. Please try again.")
    }
  }

  const handleQuotePolicyChange = async (next: QuoteApprovalPolicy) => {
    if (next === quotePolicy || quotePolicySaving) return
    const previous = quotePolicy
    setQuotePolicy(next)
    setQuotePolicySaving(true)
    setActionError(null)
    const updated = await updateStatusInteractionPolicy({
      statusId: status.id,
      quoteApprovalPolicy: next
    })
    setQuotePolicySaving(false)
    if (!updated) {
      setQuotePolicy(previous)
      setActionError(
        "Couldn't change who can quote this post. Please try again."
      )
    }
  }

  const handleUnmute = async () => {
    setActionError(null)
    try {
      const next = await unmute({ targetActorId })
      if (!next) {
        setActionError('Failed to unmute account. Please try again.')
        return
      }
      setRelationship(next)
      router.refresh()
    } catch {
      setActionError('Failed to unmute account. Please try again.')
    }
  }

  const handleUnblock = async () => {
    setActionError(null)
    try {
      const next = await unblock({ targetActorId })
      if (!next) {
        setActionError('Failed to unblock account. Please try again.')
        return
      }
      setRelationship(next)
      router.refresh()
    } catch {
      setActionError('Failed to unblock account. Please try again.')
    }
  }

  return (
    <div
      className={cn('relative', className)}
      onClick={(e) => e.stopPropagation()}
    >
      {actionError ? (
        <span
          className="pointer-events-none absolute right-0 top-full z-10 mt-1 w-max max-w-[min(14rem,calc(100vw-2rem))] break-words rounded-md border bg-background px-2 py-1 text-left text-xs text-destructive shadow-sm"
          role="alert"
        >
          {actionError}
        </span>
      ) : null}
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open)
          if (open) void loadRelationship()
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
            aria-label="More actions"
          >
            <MoreHorizontal className="size-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-60"
          onCloseAutoFocus={(event) => {
            const deferred = deferredSelectRef.current
            if (!deferred) return
            deferredSelectRef.current = null
            // The action opens its own surface and focuses it; pulling focus
            // back to the ⋯ trigger here would undo that.
            event.preventDefault()
            deferred()
          }}
        >
          {extraItems && extraItems.length > 0 ? (
            <>
              {extraItems.map((item) =>
                item.items ? (
                  <DropdownMenuSub key={item.key}>
                    {/* The trigger takes the same `disabled` prop its rows do
                        — Radix routes `SubTrigger` through the very same
                        `MenuItemImpl` — and it needs it: a submenu whose every
                        row is disabled is still openable on its own, so an
                        owner mid-write would find a menu of choices none of
                        which respond. */}
                    <DropdownMenuSubTrigger disabled={item.disabled}>
                      {item.icon}
                      {item.label}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-60">
                      {item.items.map((subItem) => (
                        <DropdownMenuItem
                          key={subItem.key}
                          disabled={subItem.disabled}
                          // A pick-one list, like the visibility submenu below:
                          // the check mark is decorative, so `aria-checked` is
                          // the only thing announcing the current choice.
                          role="menuitemradio"
                          aria-checked={subItem.checked}
                          onSelect={subItem.onSelect}
                        >
                          <span
                            className={cn(
                              'flex-1 truncate',
                              subItem.muted && 'text-muted-foreground'
                            )}
                          >
                            {subItem.label}
                          </span>
                          {subItem.trailing ? (
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {subItem.trailing}
                            </span>
                          ) : null}
                          {subItem.checked ? (
                            <Check className="size-4 shrink-0 text-primary" />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : (
                  <DropdownMenuItem
                    key={item.key}
                    disabled={item.disabled}
                    onSelect={() => {
                      if (!item.deferUntilClosed) {
                        item.onSelect()
                        return
                      }
                      deferredSelectRef.current = item.onSelect
                    }}
                  >
                    {item.icon}
                    {item.label}
                  </DropdownMenuItem>
                )
              )}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {onQuote ? (
            <>
              <DropdownMenuItem onSelect={() => onQuote(status)}>
                <MessageSquareQuote className="size-4" />
                Quote post
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {isOwner ? (
            <>
              {canEdit ? (
                <DropdownMenuItem
                  onSelect={() => onEdit?.(status as EditableStatus)}
                >
                  <Pencil className="size-4" />
                  Edit post
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Globe className="size-4" />
                  Change visibility
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  {VISIBILITY_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      disabled={visibilitySaving}
                      onSelect={() => {
                        // Let the menu close on select so a failure's inline
                        // error isn't hidden behind the open (portaled) menu.
                        void handleVisibilityChange(option.value)
                      }}
                    >
                      {option.icon}
                      <span className="flex-1">{option.label}</span>
                      {option.value === visibility ? (
                        <Check className="size-4 text-primary" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <MessageSquareQuote className="size-4" />
                  Change who can quote
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  {QUOTE_POLICY_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      disabled={quotePolicySaving}
                      onSelect={() => {
                        void handleQuotePolicyChange(option.value)
                      }}
                    >
                      {option.icon}
                      <span className="flex-1">{option.label}</span>
                      {option.value === quotePolicy ? (
                        <Check className="size-4 text-primary" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => onReply?.(status)}>
                <AtSign className="size-4" />
                <span className="min-w-0 truncate" title={`Mention ${mention}`}>
                  Mention {mention}
                </span>
              </DropdownMenuItem>
              {relationship?.muting ? (
                <DropdownMenuItem onSelect={() => void handleUnmute()}>
                  <VolumeX className="size-4" />
                  <span
                    className="min-w-0 truncate"
                    title={`Unmute ${actorName}`}
                  >
                    Unmute {actorName}
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setDialog('mute')}>
                  <VolumeX className="size-4" />
                  <span
                    className="min-w-0 truncate"
                    title={`Mute ${actorName}`}
                  >
                    Mute {actorName}
                  </span>
                </DropdownMenuItem>
              )}
              {relationship?.blocking ? (
                <DropdownMenuItem onSelect={() => void handleUnblock()}>
                  <Ban className="size-4" />
                  <span
                    className="min-w-0 truncate"
                    title={`Unblock ${actorName}`}
                  >
                    Unblock {actorName}
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setDialog('block')}>
                  <Ban className="size-4" />
                  <span
                    className="min-w-0 truncate"
                    title={`Block ${actorName}`}
                  >
                    Block {actorName}
                  </span>
                </DropdownMenuItem>
              )}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              void copyLink()
            }}
          >
            {copied ? (
              <Check className="size-4 text-primary" />
            ) : (
              <LinkIcon className="size-4" />
            )}
            {copied ? 'Link copied' : 'Copy link to post'}
          </DropdownMenuItem>
          {showOpenOriginal ? (
            <DropdownMenuItem asChild>
              <a href={statusUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                Open original
              </a>
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />
          {isOwner ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDialog('delete')}
            >
              <Trash2 className="size-4" />
              Delete post
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDialog('report')}
            >
              <TriangleAlert className="size-4" />
              Report post
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <MuteDialog
        open={dialog === 'mute'}
        onOpenChange={(open) => setDialog(open ? 'mute' : null)}
        actorName={actorName}
        targetActorId={targetActorId}
        onMuted={setRelationship}
      />
      <BlockDialog
        open={dialog === 'block'}
        onOpenChange={(open) => setDialog(open ? 'block' : null)}
        actorName={actorName}
        targetActorId={targetActorId}
        onBlocked={setRelationship}
      />
      <ReportDialog
        open={dialog === 'report'}
        onOpenChange={(open) => setDialog(open ? 'report' : null)}
        targetActorId={targetActorId}
        statusId={status.id}
      />
      <DeleteDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        status={status}
        onPostDeleted={onPostDeleted}
      />
    </div>
  )
}
