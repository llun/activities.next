'use client'

import { Search, Trash2, UserMinus, UserPlus, Users } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import {
  addListAccounts,
  createList,
  deleteList,
  removeListAccounts,
  updateList
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import { ListEntity } from '@/lib/types/mastodon/list'

export interface ListMember {
  // The Mastodon Account `id` (a publicId, or the legacy `urlToId` form on a
  // pre-backfill row — the raw URI lives in `account.uri`/`account.url`). Sent
  // as-is to the list accounts API, which resolves either form.
  id: string
  name: string
  handle: string
  avatar?: string
}

type RepliesPolicy = ListEntity['replies_policy']

const REPLIES_POLICY_OPTIONS: { value: RepliesPolicy; label: string }[] = [
  { value: 'followed', label: 'People I follow' },
  { value: 'list', label: 'Members of the list' },
  { value: 'none', label: 'No one' }
]

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

interface ListEditorProps {
  mode: 'create' | 'edit'
  list?: ListEntity
  initialMembers?: ListMember[]
  followingSuggestions?: ListMember[]
  // The list owner's own account. The owner may add themselves (no follow
  // needed) so the list shows their posts alongside the members'.
  currentAccount?: ListMember
}

export const ListEditor: FC<ListEditorProps> = ({
  mode,
  list,
  initialMembers = [],
  followingSuggestions = [],
  currentAccount
}) => {
  const router = useRouter()

  const [title, setTitle] = useState(list?.title ?? '')
  const [repliesPolicy, setRepliesPolicy] = useState<RepliesPolicy>(
    list?.replies_policy ?? 'list'
  )
  const [exclusive, setExclusive] = useState(list?.exclusive ?? false)

  const [members, setMembers] = useState<ListMember[]>(initialMembers)
  const [search, setSearch] = useState('')
  const [isDropdownOpen, setDropdownOpen] = useState(false)
  const [isSaving, setSaving] = useState(false)
  const [isDeleting, setDeleting] = useState(false)
  const [pendingMemberIds, setPendingMemberIds] = useState<Set<string>>(
    new Set()
  )
  // Each failure shows where it happened: the Save footer, the members, the
  // danger zone.
  const [saveError, setSaveError] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [])

  const memberIds = useMemo(
    () => new Set(members.map((member) => member.id)),
    [members]
  )

  const suggestions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (query.length === 0) return []
    return followingSuggestions
      .filter((account) => !memberIds.has(account.id))
      .filter(
        (account) =>
          account.name.toLowerCase().includes(query) ||
          account.handle.toLowerCase().includes(query)
      )
      .slice(0, 5)
  }, [followingSuggestions, memberIds, search])

  const setMemberPending = (id: string, pending: boolean) =>
    setPendingMemberIds((previous) => {
      const next = new Set(previous)
      if (pending) next.add(id)
      else next.delete(id)
      return next
    })

  const addMember = async (account: ListMember): Promise<boolean> => {
    if (!list) return false
    setMemberError(null)
    setMemberPending(account.id, true)
    try {
      const ok = await addListAccounts({
        listId: list.id,
        accountIds: [account.id]
      })
      if (!ok) {
        setMemberError('Could not add that account. Please try again.')
        return false
      }
      setMembers((previous) => [...previous, account])
      return true
    } catch {
      setMemberError('Could not add that account. Please try again.')
      return false
    } finally {
      // Always clear pending, even when the request throws, so the row's
      // Add/Remove control never stays permanently disabled.
      setMemberPending(account.id, false)
    }
  }

  const removeMember = async (account: ListMember) => {
    if (!list) return
    setMemberError(null)
    setMemberPending(account.id, true)
    try {
      const ok = await removeListAccounts({
        listId: list.id,
        accountIds: [account.id]
      })
      if (!ok) {
        setMemberError('Could not remove that account. Please try again.')
        return
      }
      setMembers((previous) =>
        previous.filter((member) => member.id !== account.id)
      )
    } catch {
      setMemberError('Could not remove that account. Please try again.')
    } finally {
      setMemberPending(account.id, false)
    }
  }

  const handleSave = async () => {
    if (isDeleting) return
    const trimmed = title.trim()
    if (trimmed.length === 0) {
      setSaveError('Please enter a list name.')
      return
    }
    setSaveError(null)
    setSaving(true)
    try {
      if (mode === 'create') {
        const created = await createList({
          title: trimmed,
          repliesPolicy,
          exclusive
        })
        if (!created) {
          setSaveError('Could not create the list. Please try again.')
          return
        }
        // Send new members straight to the member editor on the created list.
        router.push(`/lists/${created.id}/edit`)
        router.refresh()
        return
      }

      if (!list) return
      const updated = await updateList({
        listId: list.id,
        title: trimmed,
        repliesPolicy,
        exclusive
      })
      if (!updated) {
        setSaveError('Could not save your changes. Please try again.')
        return
      }
      router.push(`/lists/${list.id}`)
      router.refresh()
    } catch {
      // createList/updateList throw on a network/abort error rather than
      // returning null; surface the same inline error so the user can retry.
      setSaveError(
        mode === 'create'
          ? 'Could not create the list. Please try again.'
          : 'Could not save your changes. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!list) return
    if (
      !window.confirm(
        `Delete “${list.title}”? This removes the list but not the accounts on it.`
      )
    ) {
      return
    }
    setDeleteError(null)
    setDeleting(true)
    try {
      const ok = await deleteList(list.id)
      if (!ok) {
        setDeleteError('Could not delete the list. Please try again.')
        return
      }
      router.push('/lists')
      router.refresh()
    } catch {
      setDeleteError('Could not delete the list. Please try again.')
    } finally {
      // On a thrown request the success path returns early; clear the flag here
      // so the Delete/Save buttons don't stay disabled.
      setDeleting(false)
    }
  }

  // A new list has nothing saved yet; an existing one is dirty once a setting
  // differs from what loaded. Members save as they change, so they never count.
  const isDirty =
    mode === 'create' ||
    title !== (list?.title ?? '') ||
    repliesPolicy !== (list?.replies_policy ?? 'list') ||
    exclusive !== (list?.exclusive ?? false)

  const cancelHref = mode === 'edit' && list ? `/lists/${list.id}` : '/lists'

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === 'create' ? 'New list' : 'Edit list'}
        description={
          mode === 'create'
            ? 'Create a curated timeline from accounts you follow.'
            : undefined
        }
      />

      <Section title="Details">
        <Frame
          divided
          footer={
            <SaveBar
              dirty={isDirty}
              saving={isSaving}
              saved={false}
              error={saveError}
              onSave={handleSave}
              actions={
                // A link, so a request still running when it is followed
                // would finish after the page has gone: off until it is done.
                isSaving || isDeleting ? (
                  <Button variant="outline" disabled>
                    Cancel
                  </Button>
                ) : (
                  <Button variant="outline" asChild>
                    <Link href={cancelHref}>Cancel</Link>
                  </Button>
                )
              }
            />
          }
        >
          <FormRow label="List name" htmlFor="list-name">
            <Input
              id="list-name"
              value={title}
              maxLength={255}
              placeholder="e.g. Running club"
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormRow>

          <FormRow
            label="Include replies from list members to"
            htmlFor="list-replies-policy"
            hint="Whose replies should appear in this list’s timeline."
          >
            {({ describedBy }) => (
              <Select
                id="list-replies-policy"
                aria-describedby={describedBy}
                value={repliesPolicy}
                onChange={(event) =>
                  setRepliesPolicy(event.target.value as RepliesPolicy)
                }
              >
                {REPLIES_POLICY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </FormRow>

          <FormRow
            inline
            label="Hide members from Home"
            htmlFor="list-exclusive"
            hint="If someone is on this list, hide their posts from your Home timeline to avoid seeing them twice. Your own posts always stay in Home."
          >
            {({ describedBy }) => (
              <Switch
                id="list-exclusive"
                aria-describedby={describedBy}
                checked={exclusive}
                onCheckedChange={setExclusive}
              />
            )}
          </FormRow>
        </Frame>
      </Section>

      {mode === 'edit' && list && (
        <Section
          title="Members"
          meta={
            members.length > 0 ? `${members.length} in this list` : undefined
          }
          description="Add or remove accounts you follow. Changes apply right away."
        >
          {memberError && <Alert title={memberError} />}

          {currentAccount && !memberIds.has(currentAccount.id) && (
            <Frame muted>
              {/* flex-wrap + the text's basis let the button drop below the
                  text on a narrow row instead of squeezing it to a word per
                  line. */}
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar className="size-10">
                  {currentAccount.avatar && (
                    <AvatarImage src={currentAccount.avatar} alt="" />
                  )}
                  <AvatarFallback>
                    {getInitials(currentAccount.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-sm font-medium">Your posts</p>
                  <p className="text-sm text-muted-foreground">
                    Show your own posts in this list.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto shrink-0"
                  disabled={pendingMemberIds.has(currentAccount.id)}
                  onClick={() => addMember(currentAccount)}
                >
                  <UserPlus className="size-4" />
                  Add yourself
                </Button>
              </div>
            </Frame>
          )}

          <div ref={wrapRef} className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              aria-label="Search accounts you follow"
              placeholder="Search accounts you follow"
              onChange={(event) => {
                setSearch(event.target.value)
                setDropdownOpen(true)
              }}
              onFocus={() => setDropdownOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setDropdownOpen(false)
              }}
            />

            {isDropdownOpen && search.trim().length > 0 && (
              <div className="absolute left-0 right-0 top-full z-40 mt-1.5 rounded-lg border bg-popover p-1 shadow-lg">
                {suggestions.length > 0 ? (
                  <ul className="divide-y divide-border/50">
                    {suggestions.map((account) => (
                      <li
                        key={account.id}
                        className="flex items-center gap-3 rounded-md p-2 hover:bg-accent/50"
                      >
                        <Avatar className="size-8">
                          {account.avatar && (
                            <AvatarImage src={account.avatar} />
                          )}
                          <AvatarFallback>
                            {getInitials(account.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {account.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            @{account.handle}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={pendingMemberIds.has(account.id)}
                          onClick={async () => {
                            const added = await addMember(account)
                            if (added) {
                              setSearch('')
                              setDropdownOpen(false)
                            }
                          }}
                        >
                          <UserPlus className="size-4" />
                          Add
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-3 text-center text-sm text-muted-foreground">
                    No accounts match your search.
                  </p>
                )}
              </div>
            )}
          </div>

          {members.length > 0 ? (
            <FramedList aria-label="Members of this list">
              {members.map((member) => {
                const isSelf = member.id === currentAccount?.id
                return (
                  <FramedListItem
                    key={member.id}
                    className="flex items-center gap-3"
                  >
                    <Avatar className="size-10">
                      {member.avatar && <AvatarImage src={member.avatar} />}
                      <AvatarFallback>
                        {getInitials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span className="min-w-0 truncate">{member.name}</span>
                        {isSelf && <Badge className="shrink-0">You</Badge>}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        @{member.handle}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={
                        isSelf ? 'Remove yourself' : `Remove ${member.name}`
                      }
                      disabled={pendingMemberIds.has(member.id)}
                      onClick={() => removeMember(member)}
                    >
                      <UserMinus className="size-4 text-destructive-text" />
                    </Button>
                  </FramedListItem>
                )
              })}
            </FramedList>
          ) : (
            <EmptyState icon={Users} title="No members yet">
              {followingSuggestions.length === 0
                ? 'Follow some accounts to add them to this list.'
                : 'This list has no members yet. Use the search above to add accounts you follow.'}
            </EmptyState>
          )}
        </Section>
      )}

      {mode === 'edit' && list && (
        <Section title="Danger zone">
          <Frame className="overflow-hidden">
            <Alert
              flush
              live={false}
              title="Delete this list"
              action={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDeleting || isSaving}
                  onClick={handleDelete}
                >
                  <Trash2 className="size-4" />
                  Delete list
                </Button>
              }
            >
              This removes the list but not the accounts on it.
            </Alert>
          </Frame>
          {deleteError && <Alert title={deleteError} />}
        </Section>
      )}
    </div>
  )
}
