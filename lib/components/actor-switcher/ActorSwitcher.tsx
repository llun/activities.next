'use client'

import {
  Check,
  ChevronsUpDown,
  Clock,
  LogOut,
  Plus,
  ShieldCheck,
  SquarePen,
  UserRound
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { cancelActorDeletion, switchActor } from '@/lib/client'
import { setActiveOfflineSession } from '@/lib/client/offline'
import { ActorDisplayName } from '@/lib/components/actors/ActorDisplayName'
import {
  confirmDiscardProfileChanges,
  revokeProfileUnloadAllowance
} from '@/lib/components/settings/profile/unsavedProfileChanges'
import { SignOutDialog } from '@/lib/components/sign-out/SignOutDialog'
import { Alert } from '@/lib/components/surface/Alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { AddActorDialog } from './AddActorDialog'

export interface ActorInfo {
  id: string
  username: string
  domain: string
  name?: string | null
  iconUrl?: string | null
  tags?: { type: string; name: string; value: string }[] | null
  deletionStatus?: string | null
  deletionScheduledAt?: number | null
}

export interface ActorSwitcherProps {
  currentActor?: ActorInfo | null
  actors?: ActorInfo[]
  user?: {
    name?: string | null
    username?: string
    handle?: string
    avatarUrl?: string | null
  } | null
  onNavigate?: () => void
  variant?: 'row' | 'rail'
  drawer?: boolean
}

export function ActorSwitcher({
  currentActor,
  actors = [],
  user,
  onNavigate,
  variant = 'row',
  drawer = false
}: ActorSwitcherProps) {
  const router = useRouter()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSignOutOpen, setIsSignOutOpen] = useState(false)
  // A dialog opened straight from a menu item is closed again when the menu
  // hands focus back to its trigger, so the item only records it and the menu
  // opens it once it has closed (as the post menu does).
  const deferredSelectRef = useRef<(() => void) | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)
  const isCancellingRef = useRef(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    isCancellingRef.current = false
    setIsCancelling(false)
  }, [actors])

  if (!currentActor && !user) {
    return null
  }

  const avatarUrl = currentActor ? currentActor.iconUrl : user?.avatarUrl
  const displayName = currentActor
    ? currentActor.name || currentActor.username
    : user?.name || user?.username || ''
  const username = currentActor ? currentActor.username : user?.username || ''
  const handle = currentActor
    ? `@${currentActor.username}@${currentActor.domain}`
    : user?.handle
      ? user.handle.startsWith('@')
        ? user.handle
        : `@${user.handle}`
      : ''
  const profileHref = currentActor
    ? `/@${currentActor.username}@${currentActor.domain}`
    : user?.handle
      ? `/${user.handle}`
      : '#'
  const domain = currentActor
    ? currentActor.domain
    : user?.handle
      ? user.handle.split('@').filter(Boolean)[1] || ''
      : ''
  const tags = currentActor ? currentActor.tags : null

  const getAvatarInitial = (name: string) => {
    if (!name) return '?'
    return name[0].toUpperCase()
  }

  const getHandle = (actor: ActorInfo) => `@${actor.username}@${actor.domain}`

  const handleSwitchActor = async (actorId: string) => {
    if ((currentActor && actorId === currentActor.id) || isSwitching) return

    // Check if actor is pending deletion
    const actor = actors.find((a) => a.id === actorId)
    if (actor?.deletionStatus) return

    // Before the session changes, so Keep editing leaves everything as it was.
    if (!confirmDiscardProfileChanges()) return

    setIsSwitching(true)
    setError(null)
    try {
      const didSwitch = await switchActor({ actorId })

      if (didSwitch) {
        try {
          await setActiveOfflineSession({ actorId })
        } catch {
          // safe ignore
        }
        // Use hard navigation to ensure full page reload with new actor
        window.location.reload()
      } else {
        revokeProfileUnloadAllowance()
        setError('Failed to switch actor')
      }
    } catch (err) {
      revokeProfileUnloadAllowance()
      setError(err instanceof Error ? err.message : 'Failed to switch actor')
    } finally {
      setIsSwitching(false)
    }
  }

  const handleCancelDeletion = async (
    actorId: string,
    e?: React.MouseEvent | React.SyntheticEvent
  ) => {
    e?.stopPropagation()
    if (isCancellingRef.current || isCancelling) return

    isCancellingRef.current = true
    setIsCancelling(true)
    setError(null)
    try {
      await cancelActorDeletion({ actorId })
      router.refresh()
    } catch (err) {
      isCancellingRef.current = false
      setIsCancelling(false)
      setError(
        err instanceof Error ? err.message : 'Failed to cancel actor deletion'
      )
    }
  }

  const handleActorCreated = () => {
    setIsDialogOpen(false)
    // Use hard navigation to ensure full page reload with new actor
    window.location.reload()
  }

  const avatar40 = (
    <Avatar className="h-10 w-10 shrink-0">
      {avatarUrl && <AvatarImage src={avatarUrl} />}
      <AvatarFallback className="bg-(--skeleton) font-semibold text-muted-foreground dark:bg-input">
        {getAvatarInitial(username)}
      </AvatarFallback>
    </Avatar>
  )

  const isRail = variant === 'rail'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {isRail ? (
            <button
              type="button"
              aria-label={`Account menu for ${displayName}`}
              className="block p-1 -m-1 border-0 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
            >
              {avatar40}
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Account menu for ${displayName}`}
              className={cn(
                'flex items-center gap-3 w-full rounded-lg p-2 cursor-pointer hover:bg-muted transition-colors text-left overflow-hidden',
                drawer && 'min-h-[44px]'
              )}
            >
              {avatar40}
              <div className="flex-1 overflow-hidden min-w-0">
                <p className="text-sm font-medium truncate">
                  {currentActor ? (
                    <ActorDisplayName name={displayName} tags={tags} />
                  ) : (
                    displayName
                  )}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {handle}
                </p>
              </div>
              <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={isRail ? 'right' : 'top'}
          align={isRail ? 'end' : 'start'}
          sideOffset={isRail ? 12 : undefined}
          className="w-[280px]"
          onCloseAutoFocus={(event) => {
            const deferred = deferredSelectRef.current
            if (!deferred) return
            deferredSelectRef.current = null
            event.preventDefault()
            deferred()
          }}
        >
          {/* 1. Non-interactive header */}
          <DropdownMenuLabel className="flex items-center gap-3 p-2 min-w-0 font-normal">
            {avatar40}
            <div className="flex-1 overflow-hidden min-w-0">
              <p className="text-sm font-semibold truncate">
                {currentActor ? (
                  <ActorDisplayName name={displayName} tags={tags} />
                ) : (
                  displayName
                )}
              </p>
              <p className="text-xs text-muted-foreground truncate">{handle}</p>
            </div>
          </DropdownMenuLabel>

          {/* 2. Separator */}
          <DropdownMenuSeparator />

          {/* 3. View profile */}
          <DropdownMenuItem
            asChild
            className={cn(
              'cursor-pointer',
              drawer && 'pointer-coarse:min-h-[44px]'
            )}
          >
            <Link href={profileHref} prefetch={false} onClick={onNavigate}>
              <UserRound className="h-4 w-4 mr-2" />
              View profile
            </Link>
          </DropdownMenuItem>

          {/* 4. Edit profile */}
          <DropdownMenuItem
            asChild
            className={cn(
              'cursor-pointer',
              drawer && 'pointer-coarse:min-h-[44px]'
            )}
          >
            <Link
              href="/settings/profile"
              prefetch={false}
              onClick={onNavigate}
            >
              <SquarePen className="h-4 w-4 mr-2" />
              Edit profile
            </Link>
          </DropdownMenuItem>

          {/* 5. Separator */}
          <DropdownMenuSeparator />

          {/* 6. Switch profile list (when actors.length > 1) */}
          {actors.length > 1 && (
            <>
              <div className="px-2 pt-1.5 pb-0.5 text-xs font-semibold text-muted-foreground">
                Switch profile
              </div>
              {actors.map((actor) => {
                const isPendingDeletion = actor.deletionStatus === 'scheduled'
                const isDeleting = actor.deletionStatus === 'deleting'
                const isCurrent = currentActor && actor.id === currentActor.id
                const isDisabled = isSwitching || isDeleting || isCancelling
                const reducedOpacity = isPendingDeletion || isDeleting

                return (
                  <DropdownMenuItem
                    key={actor.id}
                    onSelect={() => {
                      if (isPendingDeletion) {
                        handleCancelDeletion(actor.id)
                      } else if (!isDeleting) {
                        handleSwitchActor(actor.id)
                      }
                    }}
                    disabled={isDisabled}
                    className={cn(
                      'flex items-center gap-3 cursor-pointer min-h-[44px]',
                      drawer && 'pointer-coarse:min-h-[44px]'
                    )}
                  >
                    <Avatar
                      className={cn(
                        'h-8 w-8 shrink-0',
                        reducedOpacity && 'opacity-60'
                      )}
                    >
                      {actor.iconUrl && <AvatarImage src={actor.iconUrl} />}
                      <AvatarFallback className="bg-(--skeleton) font-semibold text-muted-foreground dark:bg-input text-xs">
                        {getAvatarInitial(actor.username)}
                      </AvatarFallback>
                    </Avatar>
                    <div
                      className={cn(
                        'flex-1 overflow-hidden min-w-0',
                        reducedOpacity && 'opacity-60'
                      )}
                    >
                      <p className="text-sm font-medium truncate">
                        <ActorDisplayName
                          name={actor.name || actor.username}
                          tags={actor.tags}
                        />
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {isPendingDeletion ? (
                          <span className="text-warning-text flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Pending deletion
                          </span>
                        ) : isDeleting ? (
                          <span className="text-destructive-text">
                            Deleting…
                          </span>
                        ) : (
                          getHandle(actor)
                        )}
                      </p>
                    </div>
                    {isCurrent && !isPendingDeletion && !isDeleting && (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    )}
                    {isPendingDeletion && (
                      <button
                        type="button"
                        onClick={(e) => {
                          handleCancelDeletion(actor.id, e)
                        }}
                        disabled={isCancelling}
                        className="text-xs text-primary-text hover:text-primary-text px-2 py-1 rounded hover:bg-muted cursor-pointer shrink-0"
                        title="Cancel deletion"
                      >
                        Cancel
                      </button>
                    )}
                  </DropdownMenuItem>
                )
              })}
            </>
          )}

          {/* 7. Add another profile */}
          <DropdownMenuItem
            onSelect={() => {
              deferredSelectRef.current = () => setIsDialogOpen(true)
            }}
            className={cn(
              'cursor-pointer',
              drawer && 'pointer-coarse:min-h-[44px]'
            )}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add another profile
          </DropdownMenuItem>

          {/* 8. Separator */}
          <DropdownMenuSeparator />

          {/* 9. Account & security */}
          <DropdownMenuItem
            asChild
            className={cn(
              'cursor-pointer',
              drawer && 'pointer-coarse:min-h-[44px]'
            )}
          >
            <Link href="/account" prefetch={false} onClick={onNavigate}>
              <ShieldCheck className="h-4 w-4 mr-2" />
              Account & security
            </Link>
          </DropdownMenuItem>

          {/* 10. Sign out */}
          <DropdownMenuItem
            onSelect={() => {
              deferredSelectRef.current = () => setIsSignOutOpen(true)
            }}
            className={cn(
              'cursor-pointer',
              drawer && 'pointer-coarse:min-h-[44px]'
            )}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? <Alert title={error} className="mt-1" /> : null}

      <AddActorDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        domain={domain}
        onSuccess={handleActorCreated}
      />

      <SignOutDialog open={isSignOutOpen} onOpenChange={setIsSignOutOpen} />
    </>
  )
}
