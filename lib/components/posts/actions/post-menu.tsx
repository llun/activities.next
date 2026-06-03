'use client'

import {
  AtSign,
  Ban,
  Check,
  ExternalLink,
  Globe,
  Link as LinkIcon,
  Loader2,
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
  type ReportCategory,
  block,
  createReport,
  deleteStatus,
  getRelationship,
  mute,
  unblock,
  unmute,
  updateStatusVisibility
} from '@/lib/client'
import { getActorIdMention } from '@/lib/components/posts/actor'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
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

const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'spam', label: "It's spam" },
  { value: 'violation', label: 'It violates server rules' },
  { value: 'legal', label: "It's illegal" },
  { value: 'other', label: "It's something else" }
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
// system's section dropdowns).
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muteNotifications, setMuteNotifications] = useState(true)
  const [reportCategory, setReportCategory] = useState<ReportCategory>('spam')
  const [reportComment, setReportComment] = useState('')
  // Failure feedback for the direct (non-dialog) menu actions — unmute,
  // unblock, change visibility — which close the menu and so have no dialog to
  // surface an error in. Auto-dismisses.
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!actionError) return
    const timeoutId = setTimeout(() => setActionError(null), 4000)
    return () => clearTimeout(timeoutId)
  }, [actionError])

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

  const openDialog = (next: ActiveDialog) => {
    setError(null)
    setDialog(next)
  }

  const closeDialog = () => {
    if (submitting) return
    setDialog(null)
    setError(null)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(statusUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
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

  const handleMute = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const next = await mute({
        targetActorId,
        notifications: muteNotifications
      })
      if (!next || !next.muting) {
        setError('Failed to mute account. Please try again.')
        return
      }
      setRelationship(next)
      setDialog(null)
      router.refresh()
    } catch {
      setError('Failed to mute account. Please try again.')
    } finally {
      setSubmitting(false)
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

  const handleBlock = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const next = await block({ targetActorId })
      if (!next || !next.blocking) {
        setError('Failed to block account. Please try again.')
        return
      }
      setRelationship(next)
      setDialog(null)
      router.refresh()
    } catch {
      setError('Failed to block account. Please try again.')
    } finally {
      setSubmitting(false)
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

  const handleReport = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const success = await createReport({
        targetActorId,
        statusId: status.id,
        category: reportCategory,
        comment: reportComment.trim() || undefined
      })
      if (!success) {
        setError('Failed to submit report. Please try again.')
        return
      }
      setDialog(null)
      setReportComment('')
      setReportCategory('spam')
    } catch {
      setError('Failed to submit report. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    setSubmitting(true)
    setError(null)
    let deleted = false
    try {
      deleted = await deleteStatus({ statusId: status.id })
      if (!deleted) {
        setError('Failed to delete post. Please try again.')
      }
    } catch {
      setError('Failed to delete post. Please try again.')
    } finally {
      setSubmitting(false)
    }
    // Run success side-effects outside the try so a throwing onPostDeleted
    // callback can't mislabel a delete that already succeeded.
    if (deleted) {
      setDialog(null)
      onPostDeleted?.(status)
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
                      onSelect={(e) => {
                        e.preventDefault()
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
                Mention {mention}
              </DropdownMenuItem>
              {relationship?.muting ? (
                <DropdownMenuItem onSelect={() => void handleUnmute()}>
                  <VolumeX className="size-4" />
                  Unmute {actorName}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => openDialog('mute')}>
                  <VolumeX className="size-4" />
                  Mute {actorName}
                </DropdownMenuItem>
              )}
              {relationship?.blocking ? (
                <DropdownMenuItem onSelect={() => void handleUnblock()}>
                  <Ban className="size-4" />
                  Unblock {actorName}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => openDialog('block')}>
                  <Ban className="size-4" />
                  Block {actorName}
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
              onSelect={() => openDialog('delete')}
            >
              <Trash2 className="size-4" />
              Delete post
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => openDialog('report')}
            >
              <TriangleAlert className="size-4" />
              Report post
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mute confirmation */}
      <Dialog
        open={dialog === 'mute'}
        onOpenChange={(open) => (open ? openDialog('mute') : closeDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mute {actorName}?</DialogTitle>
            <DialogDescription>
              Posts from this account will be hidden from your timelines. They
              can still see and reply to your posts.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={muteNotifications}
              onChange={(e) => setMuteNotifications(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Also hide notifications from this account
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleMute()}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Mute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block confirmation */}
      <Dialog
        open={dialog === 'block'}
        onOpenChange={(open) => (open ? openDialog('block') : closeDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block {actorName}?</DialogTitle>
            <DialogDescription>
              They will not be able to follow you or see your posts, and you
              will not see posts or notifications from them.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleBlock()}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report */}
      <Dialog
        open={dialog === 'report'}
        onOpenChange={(open) => (open ? openDialog('report') : closeDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report post</DialogTitle>
            <DialogDescription>
              Let the moderators know what's wrong with this post. Your report
              is sent to the moderators of your server.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              Why are you reporting this post?
            </legend>
            {REPORT_CATEGORIES.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="report-category"
                  value={option.value}
                  checked={reportCategory === option.value}
                  onChange={() => setReportCategory(option.value)}
                  className="h-4 w-4"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <textarea
            value={reportComment}
            onChange={(e) => setReportComment(e.target.value.slice(0, 1000))}
            placeholder="Additional comments (optional)"
            aria-label="Additional comments"
            rows={3}
            className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleReport()}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Submit report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={dialog === 'delete'}
        onOpenChange={(open) => (open ? openDialog('delete') : closeDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. The post will be removed from your
              profile and the timelines of anyone who follows you.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
