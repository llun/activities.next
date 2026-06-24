'use client'

import {
  Globe,
  Link2,
  Lock,
  Search,
  Trash2,
  UserMinus,
  UserPlus
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useMemo, useState } from 'react'

import {
  addCollectionAccounts,
  createCollection,
  deleteCollection,
  removeCollectionAccounts,
  updateCollection
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'
import { CollectionEntity } from '@/lib/types/mastodon/collection'

export interface CollectionMember {
  // The Mastodon Account `id` (the `urlToId`-encoded actor id). Sent as-is to
  // the collection items API, which decodes it with `idToUrl`.
  id: string
  name: string
  handle: string
  avatar?: string
}

type Visibility = CollectionEntity['visibility']

// A short blurb shown above the public feed. Well within the API's 2000-char
// description limit; kept short because it is preview copy, not an essay.
const DESCRIPTION_MAX = 500

const VISIBILITY_OPTIONS: {
  value: Visibility
  label: string
  help: string
  icon: typeof Globe
}[] = [
  {
    value: 'public',
    label: 'Public',
    help: 'Shown on your profile and shareable by link.',
    icon: Globe
  },
  {
    value: 'unlisted',
    label: 'Unlisted',
    help: 'Shareable by link, but not shown on your profile.',
    icon: Link2
  },
  {
    value: 'private',
    label: 'Private',
    help: 'Only you. There is no public link.',
    icon: Lock
  }
]

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

// Strip the leading '#' and any whitespace/punctuation the API rejects, so the
// stored topic is a single bare hashtag. The unicode classes mirror the
// server-side CollectionTopicInput regex.
const sanitizeTopic = (value: string) => value.replace(/[^\p{L}\p{N}_]/gu, '')

interface CollectionEditorProps {
  mode: 'create' | 'edit'
  collection?: CollectionEntity
  initialMembers?: CollectionMember[]
  followingSuggestions?: CollectionMember[]
}

export const CollectionEditor: FC<CollectionEditorProps> = ({
  mode,
  collection,
  initialMembers = [],
  followingSuggestions = []
}) => {
  const router = useRouter()

  const [title, setTitle] = useState(collection?.title ?? '')
  const [description, setDescription] = useState(collection?.description ?? '')
  const [topic, setTopic] = useState(collection?.topic ?? '')
  const [visibility, setVisibility] = useState<Visibility>(
    collection?.visibility ?? 'public'
  )
  const [feedEnabled, setFeedEnabled] = useState(
    collection?.feed_enabled ?? true
  )

  const [members, setMembers] = useState<CollectionMember[]>(initialMembers)
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

  const addMember = async (account: CollectionMember) => {
    if (!collection) return
    setError(null)
    setMemberPending(account.id, true)
    try {
      const ok = await addCollectionAccounts({
        collectionId: collection.id,
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
      setMemberPending(account.id, false)
    }
  }

  const removeMember = async (account: CollectionMember) => {
    if (!collection) return
    setError(null)
    setMemberPending(account.id, true)
    try {
      const ok = await removeCollectionAccounts({
        collectionId: collection.id,
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
      setError('Please enter a collection name.')
      return
    }
    setError(null)
    setSaving(true)
    const payload = {
      title: trimmed,
      // Empty strings clear the optional text fields rather than storing "".
      description: description.trim() || null,
      topic: sanitizeTopic(topic) || null,
      visibility,
      feedEnabled
    }
    try {
      if (mode === 'create') {
        const created = await createCollection(payload)
        if (!created) {
          setError('Could not create the collection. Please try again.')
          return
        }
        // Send the owner straight to the member editor on the new collection.
        router.push(`/collections/${created.id}/edit`)
        router.refresh()
        return
      }

      if (!collection) return
      const updated = await updateCollection({
        collectionId: collection.id,
        ...payload
      })
      if (!updated) {
        setError('Could not save your changes. Please try again.')
        return
      }
      router.push(`/collections/${collection.id}`)
      router.refresh()
    } catch {
      setError(
        mode === 'create'
          ? 'Could not create the collection. Please try again.'
          : 'Could not save your changes. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!collection) return
    if (
      !window.confirm(
        `Delete “${collection.title}”? This removes the collection and its feed, but not the accounts in it.`
      )
    ) {
      return
    }
    setError(null)
    setDeleting(true)
    try {
      const ok = await deleteCollection(collection.id)
      if (!ok) {
        setError('Could not delete the collection. Please try again.')
        return
      }
      router.push('/lists')
      router.refresh()
    } catch {
      setError('Could not delete the collection. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  const cancelHref =
    mode === 'edit' && collection ? `/collections/${collection.id}` : '/lists'

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title={mode === 'create' ? 'New collection' : 'Edit collection'}
        description={
          mode === 'create'
            ? 'Create a shareable feed of people you want to highlight.'
            : undefined
        }
      />

      <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
        <div className="space-y-2">
          <Label htmlFor="collection-name">Collection name</Label>
          <Input
            id="collection-name"
            value={title}
            maxLength={255}
            placeholder="e.g. Fediverse builders"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="collection-description">Description</Label>
          <Textarea
            id="collection-description"
            value={description}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder="Who are you highlighting, and why?"
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="text-right text-xs text-muted-foreground">
            {description.length} / {DESCRIPTION_MAX}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="collection-topic">Topic</Label>
          <div className="flex items-center rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring">
            <span className="pl-3 pr-1 text-sm text-muted-foreground">#</span>
            <input
              id="collection-topic"
              value={topic}
              maxLength={255}
              placeholder="fediverse"
              className="h-9 w-full rounded-md bg-transparent pr-3 text-sm outline-none"
              onChange={(event) => setTopic(sanitizeTopic(event.target.value))}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            One discovery hashtag (optional).
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium leading-none">
            Visibility
          </legend>
          <RadioGroup
            value={visibility}
            onValueChange={(value) => setVisibility(value as Visibility)}
          >
            {VISIBILITY_OPTIONS.map((option) => {
              const Icon = option.icon
              const id = `visibility-${option.value}`
              return (
                <Label
                  key={option.value}
                  htmlFor={id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/[0.06]"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {option.label}
                    </span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {option.help}
                    </span>
                  </span>
                  <RadioGroupItem id={id} value={option.value} />
                </Label>
              )
            })}
          </RadioGroup>
        </fieldset>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="collection-feed">Shareable feed</Label>
            <p className="text-sm text-muted-foreground">
              Expose this collection as a public feed. The public link shows
              only members who approved being featured.
            </p>
          </div>
          <Switch
            id="collection-feed"
            checked={feedEnabled}
            onCheckedChange={setFeedEnabled}
          />
        </div>
      </section>

      {mode === 'edit' && collection && (
        <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">People</h2>
            <p className="text-sm text-muted-foreground">
              Highlight accounts you follow. They start as pending and choose
              whether to appear on the public link from their notifications.
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
                In this collection · {members.length}
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
                : 'Follow some accounts to highlight them in this collection.'}
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
        {mode === 'edit' && collection ? (
          <Button
            variant="outline"
            className="text-destructive"
            disabled={isDeleting || isSaving}
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
            Delete collection
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
                : 'Create collection'
              : isSaving
                ? 'Saving...'
                : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
