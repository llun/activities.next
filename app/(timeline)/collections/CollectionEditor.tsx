'use client'

import {
  Globe,
  Link2,
  Lock,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
  Users
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import {
  addCollectionAccounts,
  createCollection,
  deleteCollection,
  removeCollectionAccounts,
  updateCollection
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
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'
import { CollectionEntity } from '@/lib/types/mastodon/collection'

export interface CollectionMember {
  // The Mastodon Account `id` (a publicId, or the legacy `urlToId` form on a
  // pre-backfill row). Sent as-is to the collection items API, which resolves
  // either back to an actor URI.
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
  const [isDropdownOpen, setDropdownOpen] = useState(false)
  const [isSaving, setSaving] = useState(false)
  const [isDeleting, setDeleting] = useState(false)
  const [pendingMemberIds, setPendingMemberIds] = useState<Set<string>>(
    new Set()
  )
  // Each failure shows where it happened: the Save footer, the people, the
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

  const addMember = async (account: CollectionMember): Promise<boolean> => {
    if (!collection) return false
    setMemberError(null)
    setMemberPending(account.id, true)
    try {
      const ok = await addCollectionAccounts({
        collectionId: collection.id,
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
      setMemberPending(account.id, false)
    }
  }

  const removeMember = async (account: CollectionMember) => {
    if (!collection) return
    setMemberError(null)
    setMemberPending(account.id, true)
    try {
      const ok = await removeCollectionAccounts({
        collectionId: collection.id,
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
      setSaveError('Please enter a collection name.')
      return
    }
    setSaveError(null)
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
          setSaveError('Could not create the collection. Please try again.')
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
        setSaveError('Could not save your changes. Please try again.')
        return
      }
      router.push(`/collections/${collection.id}`)
      router.refresh()
    } catch {
      setSaveError(
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
    setDeleteError(null)
    setDeleting(true)
    try {
      const ok = await deleteCollection(collection.id)
      if (!ok) {
        setDeleteError('Could not delete the collection. Please try again.')
        return
      }
      router.push('/lists')
      router.refresh()
    } catch {
      setDeleteError('Could not delete the collection. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  // A new collection has nothing saved yet; an existing one is dirty once a
  // setting differs from what loaded. People save as they change, so they never
  // count.
  const isDirty =
    mode === 'create' ||
    title !== (collection?.title ?? '') ||
    description !== (collection?.description ?? '') ||
    topic !== (collection?.topic ?? '') ||
    visibility !== (collection?.visibility ?? 'public') ||
    feedEnabled !== (collection?.feed_enabled ?? true)

  const cancelHref =
    mode === 'edit' && collection ? `/collections/${collection.id}` : '/lists'

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === 'create' ? 'New collection' : 'Edit collection'}
        description={
          mode === 'create'
            ? 'Create a shareable feed of people you want to highlight.'
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
          <FormRow label="Collection name" htmlFor="collection-name">
            <Input
              id="collection-name"
              value={title}
              maxLength={255}
              placeholder="e.g. Fediverse builders"
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormRow>

          <FormRow label="Description" htmlFor="collection-description" wide>
            <div className="space-y-1">
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
          </FormRow>

          <FormRow
            label="Topic"
            htmlFor="collection-topic"
            hint="One discovery hashtag (optional)."
          >
            {({ describedBy }) => (
              <div className="flex items-center rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring">
                <span className="pl-3 pr-1 text-sm text-muted-foreground">
                  #
                </span>
                <input
                  id="collection-topic"
                  aria-describedby={describedBy}
                  value={topic}
                  maxLength={255}
                  placeholder="fediverse"
                  className="h-9 w-full rounded-md bg-transparent pr-3 text-sm outline-none"
                  onChange={(event) =>
                    setTopic(sanitizeTopic(event.target.value))
                  }
                />
              </div>
            )}
          </FormRow>

          <FormRow label="Visibility" wide>
            {({ labelledBy }) => (
              <RadioGroup
                aria-labelledby={labelledBy}
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
                      // The radio is a Radix `<button role="radio">`, never a
                      // native input outside a <form>, so `:checked` can not
                      // see it: `data-state` is what marks the selected option.
                      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/[0.06]"
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="size-4" />
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
            )}
          </FormRow>

          <FormRow
            inline
            label="Shareable feed"
            htmlFor="collection-feed"
            hint="Expose this collection as a public feed. The public link shows only members who approved being featured."
          >
            {({ describedBy }) => (
              <Switch
                id="collection-feed"
                aria-describedby={describedBy}
                checked={feedEnabled}
                onCheckedChange={setFeedEnabled}
              />
            )}
          </FormRow>
        </Frame>
      </Section>

      {mode === 'edit' && collection && (
        <Section
          title="People"
          meta={
            members.length > 0
              ? `${members.length} in this collection`
              : undefined
          }
          description="Highlight accounts you follow. They start as pending and choose whether to appear on the public link from their notifications."
        >
          {memberError && <Alert title={memberError} />}

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
            <FramedList aria-label="People in this collection">
              {members.map((member) => (
                <FramedListItem
                  key={member.id}
                  className="flex items-center gap-3"
                >
                  <Avatar className="size-10">
                    {member.avatar && <AvatarImage src={member.avatar} />}
                    <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.name}
                    </p>
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
                    <UserMinus className="size-4 text-destructive-text" />
                  </Button>
                </FramedListItem>
              ))}
            </FramedList>
          ) : (
            <EmptyState icon={Users} title="No one in this collection yet">
              {followingSuggestions.length === 0
                ? 'Follow some accounts to highlight them in this collection.'
                : 'This collection has no members yet. Use the search above to add accounts you follow.'}
            </EmptyState>
          )}
        </Section>
      )}

      {mode === 'edit' && collection && (
        <Section title="Danger zone">
          <Frame className="overflow-hidden">
            <Alert
              flush
              live={false}
              title="Delete this collection"
              action={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDeleting || isSaving}
                  onClick={handleDelete}
                >
                  <Trash2 className="size-4" />
                  Delete collection
                </Button>
              }
            >
              This removes the collection and its feed, but not the accounts in
              it.
            </Alert>
          </Frame>
          {deleteError && <Alert title={deleteError} />}
        </Section>
      )}
    </div>
  )
}
