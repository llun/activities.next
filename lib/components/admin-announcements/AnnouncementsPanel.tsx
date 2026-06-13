'use client'

import { Plus, Trash2 } from 'lucide-react'
import { FC, FormEvent, useEffect, useState } from 'react'

import {
  type ServerAnnouncement,
  type ServerAnnouncementInput,
  createServerAnnouncement,
  deleteServerAnnouncement,
  getServerAnnouncements,
  updateServerAnnouncement
} from '@/lib/client'
import { FilterField, FilterSection } from '@/lib/components/filters/filterUi'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import { Input } from '@/lib/components/ui/input'
import { Textarea } from '@/lib/components/ui/textarea'

// The server returns announcements newest-first by createdAt. `Array.prototype
// .sort` is stable, so re-sorting after an edit preserves that order for rows
// with the same createdAt.
const sortAnnouncements = (
  announcements: ServerAnnouncement[]
): ServerAnnouncement[] =>
  [...announcements].sort((a, b) => b.created_at - a.created_at)

// Converts epoch-ms (or null) to the `YYYY-MM-DDTHH:mm` value a
// `datetime-local` input expects, in the viewer's local time. Runs only after
// the client-side fetch resolves, so it does not affect SSR/hydration.
const toLocalInputValue = (time: number | null): string => {
  if (time === null) return ''
  const date = new Date(time)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(time - offsetMs).toISOString().slice(0, 16)
}

// Converts a `datetime-local` value back to an ISO-8601 string the API accepts,
// or null when the field is empty.
const fromLocalInputValue = (value: string): string | null => {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString()
}

export const AnnouncementsPanel: FC = () => {
  const [announcements, setAnnouncements] = useState<ServerAnnouncement[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [newText, setNewText] = useState('')
  const [newStartsAt, setNewStartsAt] = useState('')
  const [newEndsAt, setNewEndsAt] = useState('')
  const [newAllDay, setNewAllDay] = useState(false)
  const [newPublished, setNewPublished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getServerAnnouncements()
      .then((result) => {
        if (active) setAnnouncements(sortAnnouncements(result))
      })
      .catch(() => {
        // A network/parse failure must surface an error rather than silently
        // showing the empty state.
        if (active)
          setListError('Failed to load announcements. Please try again.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = newText.trim()
    // Bail while another mutation is in flight to keep writes serialized.
    if (!text || saving || busyId !== null) return
    setSaving(true)
    setFormError(null)
    try {
      const input: ServerAnnouncementInput = {
        text,
        starts_at: fromLocalInputValue(newStartsAt),
        ends_at: fromLocalInputValue(newEndsAt),
        all_day: newAllDay,
        published: newPublished
      }
      // The client helper returns null on a non-ok response; throw so both that
      // and any network-layer rejection land in the same catch.
      const created = await createServerAnnouncement(input)
      if (!created) {
        throw new Error('Failed to create announcement. Please try again.')
      }
      setAnnouncements((current) => sortAnnouncements([created, ...current]))
      setNewText('')
      setNewStartsAt('')
      setNewEndsAt('')
      setNewAllDay(false)
      setNewPublished(false)
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Failed to create announcement. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  const applyUpdate = async (
    announcement: ServerAnnouncement,
    input: Partial<ServerAnnouncementInput>,
    failureMessage: string
  ) => {
    if (saving || busyId !== null) return
    setListError(null)
    setBusyId(announcement.id)
    try {
      const updated = await updateServerAnnouncement(announcement.id, input)
      if (!updated) {
        throw new Error(failureMessage)
      }
      setAnnouncements((current) =>
        sortAnnouncements(
          current.map((item) => (item.id === updated.id ? updated : item))
        )
      )
    } catch {
      setListError(failureMessage)
    } finally {
      setBusyId(null)
    }
  }

  const handleTogglePublished = (announcement: ServerAnnouncement) =>
    applyUpdate(
      announcement,
      { published: !announcement.published },
      'Failed to update announcement. Please try again.'
    )

  const handleEditText = (announcement: ServerAnnouncement, text: string) => {
    const next = text.trim()
    if (next === '' || next === announcement.text) return
    applyUpdate(
      announcement,
      { text: next },
      'Failed to update announcement. Please try again.'
    )
  }

  const handleDelete = async (announcement: ServerAnnouncement) => {
    // A mutation is already in flight — buttons are disabled while busyId is
    // set, so this guards against any racing invocation.
    if (saving || busyId !== null) return
    setListError(null)
    setBusyId(announcement.id)
    const previous = announcements
    // Optimistic removal — restore the row if the request fails.
    setAnnouncements((current) =>
      current.filter((item) => item.id !== announcement.id)
    )
    const restoreOnFailure = () => {
      setAnnouncements(previous)
      setListError('Failed to delete announcement. Please try again.')
    }
    try {
      const ok = await deleteServerAnnouncement(announcement.id)
      if (!ok) restoreOnFailure()
    } catch {
      // A network-layer throw (connection drop, etc.) must still roll back.
      restoreOnFailure()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="Instance-wide announcements served from the Mastodon announcements API. Published announcements within their active window are shown to everyone."
      />

      {listError && <p className="text-sm text-destructive">{listError}</p>}

      <FilterSection
        title="Add an announcement"
        description="Markdown is supported. Leave the start and end empty to show it immediately and indefinitely."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <FilterField label="Text" htmlFor="announcement-text">
            <Textarea
              id="announcement-text"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              maxLength={5000}
              rows={3}
              required
            />
          </FilterField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FilterField label="Starts at" htmlFor="announcement-starts-at">
              <Input
                id="announcement-starts-at"
                type="datetime-local"
                value={newStartsAt}
                onChange={(event) => setNewStartsAt(event.target.value)}
              />
            </FilterField>
            <FilterField label="Ends at" htmlFor="announcement-ends-at">
              <Input
                id="announcement-ends-at"
                type="datetime-local"
                value={newEndsAt}
                onChange={(event) => setNewEndsAt(event.target.value)}
              />
            </FilterField>
          </div>
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="announcement-all-day"
          >
            <Checkbox
              id="announcement-all-day"
              checked={newAllDay}
              onChange={(event) => setNewAllDay(event.target.checked)}
            />
            All day
          </label>
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="announcement-published"
          >
            <Checkbox
              id="announcement-published"
              checked={newPublished}
              onChange={(event) => setNewPublished(event.target.checked)}
            />
            Published
          </label>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                saving || busyId !== null || newText.trim().length === 0
              }
            >
              <Plus className="size-4" />
              Add announcement
            </Button>
          </div>
        </form>
      </FilterSection>

      <FilterSection>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading announcements…
          </p>
        ) : announcements.length === 0 && !listError ? (
          // Suppress the empty-state copy when a load error is already shown, so
          // a failed fetch doesn't read as "you have no announcements".
          <p className="py-6 text-center text-sm text-muted-foreground">
            No announcements yet — add one to show it to everyone.
          </p>
        ) : (
          <div className="space-y-4">
            {announcements.map((announcement) => (
              <div
                key={announcement.id}
                className="space-y-3 rounded-lg border p-3"
              >
                <FilterField
                  label="Text"
                  htmlFor={`announcement-text-${announcement.id}`}
                >
                  <Textarea
                    id={`announcement-text-${announcement.id}`}
                    defaultValue={announcement.text}
                    maxLength={5000}
                    rows={2}
                    disabled={busyId !== null || saving}
                    onBlur={(event) =>
                      handleEditText(announcement, event.target.value)
                    }
                  />
                </FilterField>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {announcement.starts_at !== null && (
                    <span>
                      Starts {toLocalInputValue(announcement.starts_at)}
                    </span>
                  )}
                  {announcement.ends_at !== null && (
                    <span>Ends {toLocalInputValue(announcement.ends_at)}</span>
                  )}
                  {announcement.all_day && <span>All day</span>}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleTogglePublished(announcement)}
                    disabled={busyId !== null || saving}
                  >
                    {announcement.published ? 'Unpublish' : 'Publish'}
                  </Button>
                  <button
                    type="button"
                    aria-label={`Delete announcement ${announcement.text}`}
                    onClick={() => handleDelete(announcement)}
                    disabled={busyId !== null || saving}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[hsl(0_84.2%_60.2%/0.4)] text-[hsl(0_72%_45%)] transition-colors hover:bg-[hsl(0_72%_45%/0.08)] disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </FilterSection>
    </div>
  )
}
