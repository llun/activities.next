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
  MoreHorizontal,
  Pencil,
  Trash2,
  TriangleAlert,
  Unlock,
  VolumeX
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, ReactNode, useEffect, useState } from 'react'

import {
  getRelationship,
  unblock,
  unmute,
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
import {
  EditableStatus,
  Status,
  StatusNote,
  StatusPoll
} from '@/lib/types/domain/status'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'
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

type ActiveDialog = 'mute' | 'block' | 'report' | 'delete' | null

interface Props {
  // Always the resolved note/poll (Announce statuses are unwrapped by the
  // caller), so url / to / cc are always present.
  status: StatusNote | StatusPoll
  isOwner: boolean
  canEdit: boolean
  onReply?: (status: Status) => void
  onEdit?: (status: EditableStatus) => void
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
  onReply,
  onEdit,
  onPostDeleted
}) => {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
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
    <div className="relative ml-auto" onClick={(e) => e.stopPropagation()}>
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
            type="button"
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
            aria-label="More actions"
          >
            <MoreHorizontal className="size-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
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
