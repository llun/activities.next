'use client'

import { Search, Trash2, UserMinus, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useMemo, useState } from 'react'

import {
  addListAccounts,
  createList,
  deleteList,
  removeListAccounts,
  updateList
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'
import { ListEntity } from '@/lib/types/mastodon/list'

export interface ListMember {
  // The Mastodon Account `id` (the `urlToId`-encoded actor id, not the raw
  // URI — that lives in `account.url`). Sent as-is to the list accounts API.
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
}

export const ListEditor: FC<ListEditorProps> = ({
  mode,
  list,
  initialMembers = [],
  followingSuggestions = []
}) => {
  const router = useRouter()

  const [title, setTitle] = useState(list?.title ?? '')
  const [repliesPolicy, setRepliesPolicy] = useState<RepliesPolicy>(
    list?.replies_policy ?? 'list'
  )
  const [exclusive, setExclusive] = useState(list?.exclusive ?? false)

  const [members, setMembers] = useState<ListMember[]>(initialMembers)
  const [search, setSearch] = useState('')
  const [isSaving, setSaving] = useState(false)
  const [isDeleting, setDeleting] = useState(false)
  const [pendingMemberIds, setPendingMemberIds] = useState<Set<string>>(
    new Set()
  )
  const [error, setError] = useState<string | null>(null)

  const memberIds = useMemo(
    () => new Set(members.map((member) => member.id)),
    [members]
  )

  const suggestions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return followingSuggestions
      .filter((account) => !memberIds.has(account.id))
      .filter(
        (account) =>
          query.length === 0 ||
          account.name.toLowerCase().includes(query) ||
          account.handle.toLowerCase().includes(query)
      )
  }, [followingSuggestions, memberIds, search])

  const setMemberPending = (id: string, pending: boolean) =>
    setPendingMemberIds((previous) => {
      const next = new Set(previous)
      if (pending) next.add(id)
      else next.delete(id)
      return next
    })

  const addMember = async (account: ListMember) => {
    if (!list) return
    setError(null)
    setMemberPending(account.id, true)
    try {
      const ok = await addListAccounts({
        listId: list.id,
        accountIds: [account.id]
      })
      if (!ok) {
        setError('Could not add that account. Please try again.')
        return
      }
      setMembers((previous) => [...previous, account])
    } catch {
      setError('Could not add that account. Please try again.')
    } finally {
      // Always clear pending, even when the request throws, so the row's
      // Add/Remove control never stays permanently disabled.
      setMemberPending(account.id, false)
    }
  }

  const removeMember = async (account: ListMember) => {
    if (!list) return
    setError(null)
    setMemberPending(account.id, true)
    try {
      const ok = await removeListAccounts({
        listId: list.id,
        accountIds: [account.id]
      })
      if (!ok) {
        setError('Could not remove that account. Please try again.')
        return
      }
      setMembers((previous) =>
        previous.filter((member) => member.id !== account.id)
      )
    } catch {
      setError('Could not remove that account. Please try again.')
    } finally {
      setMemberPending(account.id, false)
    }
  }

  const handleSave = async () => {
    const trimmed = title.trim()
    if (trimmed.length === 0) {
      setError('Please enter a list name.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      if (mode === 'create') {
        const created = await createList({
          title: trimmed,
          repliesPolicy,
          exclusive
        })
        if (!created) {
          setError('Could not create the list. Please try again.')
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
        setError('Could not save your changes. Please try again.')
        return
      }
      router.push(`/lists/${list.id}`)
      router.refresh()
    } catch {
      // createList/updateList throw on a network/abort error rather than
      // returning null; surface the same inline error so the user can retry.
      setError(
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
    setError(null)
    setDeleting(true)
    try {
      const ok = await deleteList(list.id)
      if (!ok) {
        setError('Could not delete the list. Please try again.')
        return
      }
      router.push('/lists')
      router.refresh()
    } catch {
      setError('Could not delete the list. Please try again.')
    } finally {
      // On a thrown request the success path returns early; clear the flag here
      // so the Delete/Save buttons don't stay disabled.
      setDeleting(false)
    }
  }

  const cancelHref = mode === 'edit' && list ? `/lists/${list.id}` : '/lists'

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title={mode === 'create' ? 'New list' : 'Edit list'}
        description={
          mode === 'create'
            ? 'Create a curated timeline from accounts you follow.'
            : undefined
        }
      />

      <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
        <div className="space-y-2">
          <Label htmlFor="list-name">List name</Label>
          <Input
            id="list-name"
            value={title}
            maxLength={255}
            placeholder="e.g. Running club"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="list-replies-policy">
            Include replies from list members to
          </Label>
          <Select
            id="list-replies-policy"
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
          <p className="text-sm text-muted-foreground">
            Whose replies should appear in this list&rsquo;s timeline.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="list-exclusive">Hide members from Home</Label>
            <p className="text-sm text-muted-foreground">
              If someone is on this list, hide their posts from your Home
              timeline to avoid seeing them twice.
            </p>
          </div>
          <Switch
            id="list-exclusive"
            checked={exclusive}
            onCheckedChange={setExclusive}
          />
        </div>
      </section>

      {mode === 'edit' && list && (
        <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-sm text-muted-foreground">
              Add or remove accounts you follow. Changes apply right away.
            </p>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              aria-label="Search accounts you follow"
              placeholder="Search accounts you follow"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {members.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                In this list · {members.length}
              </p>
              <ul className="divide-y">
                {members.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 py-3">
                    <Avatar className="h-10 w-10">
                      {member.avatar && <AvatarImage src={member.avatar} />}
                      <AvatarFallback>
                        {getInitials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{member.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        @{member.handle}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Remove ${member.name}`}
                      disabled={pendingMemberIds.has(member.id)}
                      onClick={() => removeMember(member)}
                    >
                      <UserMinus className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Suggestions
              </p>
              <ul className="divide-y">
                {suggestions.map((account) => (
                  <li key={account.id} className="flex items-center gap-3 py-3">
                    <Avatar className="h-10 w-10">
                      {account.avatar && <AvatarImage src={account.avatar} />}
                      <AvatarFallback>
                        {getInitials(account.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{account.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        @{account.handle}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={pendingMemberIds.has(account.id)}
                      onClick={() => addMember(account)}
                    >
                      <UserPlus className="h-4 w-4" />
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {members.length === 0 && suggestions.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {search.trim().length > 0
                ? 'No accounts match your search.'
                : 'Follow some accounts to add them to this list.'}
            </p>
          )}
        </section>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {mode === 'edit' && list ? (
          <Button
            variant="outline"
            className="text-destructive"
            disabled={isDeleting || isSaving}
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
            Delete list
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={isSaving || isDeleting}
            onClick={() => router.push(cancelHref)}
          >
            Cancel
          </Button>
          <Button disabled={isSaving || isDeleting} onClick={handleSave}>
            {mode === 'create'
              ? isSaving
                ? 'Creating...'
                : 'Create list'
              : isSaving
                ? 'Saving...'
                : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
