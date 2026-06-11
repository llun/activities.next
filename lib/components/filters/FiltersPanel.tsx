'use client'

import { Plus } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import {
  type ClientFilter,
  type FilterInput,
  createFilter,
  createServerFilter,
  deleteFilter,
  deleteServerFilter,
  getFilters,
  getServerFilters,
  updateFilter,
  updateServerFilter
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'

import { FilterEditor, type FilterScope } from './FilterEditor'
import { FilterRow } from './FilterRow'
import { FilterSection } from './filterUi'

interface ScopeClient {
  list: () => Promise<ClientFilter[]>
  create: (input: FilterInput) => Promise<ClientFilter | null>
  update: (id: string, input: FilterInput) => Promise<ClientFilter | null>
  remove: (id: string) => Promise<boolean>
}

const ACCOUNT_CLIENT: ScopeClient = {
  list: getFilters,
  create: createFilter,
  update: updateFilter,
  remove: deleteFilter
}

const SERVER_CLIENT: ScopeClient = {
  list: getServerFilters,
  create: createServerFilter,
  update: updateServerFilter,
  remove: deleteServerFilter
}

const COPY: Record<FilterScope, { title: string; description: string }> = {
  account: {
    title: 'Filters',
    description:
      'Hide posts containing specific words or phrases across your feeds.'
  },
  server: {
    title: 'Server filters',
    description:
      'Keyword rules that apply to everyone on this instance. Delivered through the Mastodon-compatible filter API, so apps show warnings natively.'
  }
}

interface FiltersPanelProps {
  scope: FilterScope
  currentTime: number
}

// `null` = list view, 'new' = creating, otherwise the id of the filter editing.
type EditingState = null | 'new' | string

export const FiltersPanel: FC<FiltersPanelProps> = ({ scope, currentTime }) => {
  const client = scope === 'server' ? SERVER_CLIENT : ACCOUNT_CLIENT
  const copy = COPY[scope]

  const [filters, setFilters] = useState<ClientFilter[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EditingState>(null)
  const [saving, setSaving] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    client
      .list()
      .then((result) => {
        if (!active) return
        // The account endpoint merges instance-wide server filters flagged
        // read-only; Settings manages only the user's own filters.
        setFilters(
          scope === 'account'
            ? result.filter((filter) => !filter.server)
            : result
        )
      })
      .catch(() => {
        // A network/parse failure must surface an error rather than silently
        // showing the "No filters yet" empty state.
        if (active) setListError('Failed to load filters. Please try again.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [client, scope])

  const handleSave = async (input: FilterInput) => {
    setSaving(true)
    setEditorError(null)
    try {
      if (editing === 'new') {
        // The client helpers return a falsy value on a non-ok response; throw so
        // both that and any network-layer rejection land in the same catch.
        const created = await client.create(input)
        if (!created) {
          throw new Error('Failed to create filter. Please try again.')
        }
        // Creation order — newly created filters append at the bottom.
        setFilters((current) => [...current, created])
      } else if (editing) {
        const updated = await client.update(editing, input)
        if (!updated) {
          throw new Error('Failed to save changes. Please try again.')
        }
        setFilters((current) =>
          current.map((filter) => (filter.id === updated.id ? updated : filter))
        )
      }
      setEditing(null)
    } catch (error) {
      setEditorError(
        error instanceof Error
          ? error.message
          : 'Failed to save filter. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (filter: ClientFilter) => {
    // A delete is already in flight — all delete buttons are disabled while
    // `deletingId` is set, so this guards against any racing invocation.
    if (deletingId) return
    setListError(null)
    setDeletingId(filter.id)
    const previous = filters
    // Optimistic removal — restore the row if the request fails. Deletes are
    // serialized (see the guard above), so `previous` is always the current
    // list and rolling back to it cannot resurrect a separately-deleted row.
    setFilters((current) => current.filter((item) => item.id !== filter.id))
    const restoreOnFailure = () => {
      setFilters(previous)
      setListError('Failed to delete filter. Please try again.')
    }
    try {
      const ok = await client.remove(filter.id)
      if (!ok) restoreOnFailure()
    } catch {
      // A network-layer throw (connection drop, etc.) must still roll back.
      restoreOnFailure()
    } finally {
      setDeletingId(null)
    }
  }

  if (editing !== null) {
    const initial =
      editing === 'new'
        ? null
        : (filters.find((filter) => filter.id === editing) ?? null)
    return (
      <FilterEditor
        initial={initial}
        scope={scope}
        currentTime={currentTime}
        saving={saving}
        error={editorError}
        onCancel={() => {
          setEditorError(null)
          setEditing(null)
        }}
        onSave={handleSave}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button
            onClick={() => {
              setEditorError(null)
              setEditing('new')
            }}
            // Block creating while a delete is in flight so a failed-delete
            // rollback can't drop the just-created filter from the list.
            disabled={deletingId !== null}
          >
            <Plus className="size-4" />
            Add new filter
          </Button>
        }
      />

      {listError && <p className="text-sm text-destructive">{listError}</p>}

      <FilterSection>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading filters…
          </p>
        ) : filters.length === 0 && !listError ? (
          // Suppress the empty-state copy when a load error is already shown, so
          // a failed fetch doesn't read as "you have no filters".
          <p className="py-6 text-center text-sm text-muted-foreground">
            No filters yet — add one to start hiding unwanted posts.
          </p>
        ) : (
          <div className="space-y-2">
            {filters.map((filter) => (
              <FilterRow
                key={filter.id}
                filter={filter}
                currentTime={currentTime}
                onEdit={() => {
                  setEditorError(null)
                  setEditing(filter.id)
                }}
                onDelete={() => handleDelete(filter)}
                // Disable every delete button while any delete is in flight so
                // deletes stay serialized and optimistic rollback is safe.
                deleting={deletingId !== null}
              />
            ))}
          </div>
        )}
      </FilterSection>

      {scope === 'server' && (
        <FilterSection
          title="How server filters behave"
          description="People cannot remove a server filter, but “hide with a warning” still lets them tap through to the post. Use “hide completely” only for spam."
        />
      )}
    </div>
  )
}
