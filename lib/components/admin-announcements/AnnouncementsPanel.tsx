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
import { AnnouncementBadge } from '@/lib/components/announcements/AnnouncementBanner'
import { FilterField, FilterSection } from '@/lib/components/filters/filterUi'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'

import { computeAnnouncementStatus } from './announcementStatus'

// The server returns announcements newest-first by createdAt. `Array.prototype
// .sort` is stable, so re-sorting after an edit preserves that order for rows
// with the same createdAt.
const sortAnnouncements = (
  announcements: ServerAnnouncement[]
): ServerAnnouncement[] =>
  [...announcements].sort((a, b) => b.created_at - a.created_at)

// Converts a `datetime-local` value back to an ISO-8601 string the API accepts,
// or null when the field is empty.
const fromLocalInputValue = (value: string): string | null => {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString()
}

// Formats epoch-ms as a localized, human-readable date-time for the list
// display. Passing `undefined` as the locale defaults to the viewer's browser
// locale.
const formatDateTime = (time: number): string =>
  new Date(time).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })

interface AnnouncementsPanelProps {
  // Wall clock as a number (never a Date) from the server component, used to
  // compute lifecycle status badges without a hydration mismatch.
  currentTime: number
}

export const AnnouncementsPanel: FC<AnnouncementsPanelProps> = ({
  currentTime
}) => {
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
        // For an all-day event the time-of-day is not meaningful and the picked
        // date must be treated as a zone-less calendar date. The Home banner
        // renders all-day bounds in UTC, so store UTC midnight of the picked day
        // rather than converting the naive local input to UTC (which would shift
        // the calendar date for creators not in UTC). Timed events keep the
        // local->UTC conversion.
        starts_at:
          newAllDay && newStartsAt.trim() !== ''
            ? `${newStartsAt.trim().slice(0, 10)}T00:00:00.000Z`
            : fromLocalInputValue(newStartsAt),
        // When the event is all-day, the end bound is not meaningful, so drop
        // whatever was previously typed.
        ends_at: newAllDay ? null : fromLocalInputValue(newEndsAt),
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

      {listError && <p className="text-destructive text-sm">{listError}</p>}

      <FilterSection
        title="Add an announcement"
        description="Markdown is supported. Leave the event window empty to show it immediately and indefinitely."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <FilterField
            label="Text"
            htmlFor="announcement-text"
            help="Markdown with hashtags and mentions; keep it under a few sentences. No attachments."
          >
            <Textarea
              id="announcement-text"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              maxLength={5000}
              rows={4}
              required
            />
          </FilterField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FilterField label="Event starts" htmlFor="announcement-starts-at">
              <Input
                id="announcement-starts-at"
                type="datetime-local"
                value={newStartsAt}
                onChange={(event) => setNewStartsAt(event.target.value)}
              />
            </FilterField>
            <FilterField label="Event ends" htmlFor="announcement-ends-at">
              <Input
                id="announcement-ends-at"
                type="datetime-local"
                value={newEndsAt}
                onChange={(event) => setNewEndsAt(event.target.value)}
                disabled={newAllDay}
              />
            </FilterField>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">All-day event</p>
              <p className="text-muted-foreground text-sm">
                Hide the times and show only the dates.
              </p>
            </div>
            <Switch
              id="announcement-all-day"
              checked={newAllDay}
              onCheckedChange={setNewAllDay}
              aria-label="All-day event"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Publish now</p>
              <p className="text-muted-foreground text-sm">
                Publish immediately. Leave off to save as a draft.
              </p>
            </div>
            <Switch
              id="announcement-published"
              checked={newPublished}
              onCheckedChange={setNewPublished}
              aria-label="Publish now"
            />
          </div>
          <p className="text-muted-foreground text-[0.8rem]">
            Times are stored in UTC and display in each reader&apos;s local
            timezone. The announcement disappears for everyone after the end
            date.
          </p>
          {formError && <p className="text-destructive text-sm">{formError}</p>}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                saving || busyId !== null || newText.trim().length === 0
              }
            >
              <Plus className="size-4" />
              {newPublished ? 'Publish' : 'Save draft'}
            </Button>
          </div>
        </form>
      </FilterSection>

      <FilterSection>
        {loading ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Loading announcements…
          </p>
        ) : announcements.length === 0 && !listError ? (
          // Suppress the empty-state copy when a load error is already shown, so
          // a failed fetch doesn't read as "you have no announcements".
          <p className="text-muted-foreground py-6 text-center text-sm">
            No announcements yet — add one to show it to everyone.
          </p>
        ) : (
          <div className="space-y-4">
            {announcements.map((announcement) => {
              const status = computeAnnouncementStatus(
                announcement,
                currentTime
              )
              return (
                <div
                  key={announcement.id}
                  className="space-y-3 rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2">
                    <AnnouncementBadge tone={status.tone}>
                      {status.label}
                    </AnnouncementBadge>
                  </div>
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
                      onBlur={(event) => {
                        // The textarea is uncontrolled (defaultValue), so an
                        // ignored empty edit would otherwise leave the field
                        // showing the empty value even though the stored text
                        // is unchanged. Reset it back to the persisted text so
                        // the display stays in sync without a reload.
                        if (event.target.value.trim() === '') {
                          event.target.value = announcement.text
                        }
                        handleEditText(announcement, event.target.value)
                      }}
                    />
                  </FilterField>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    {announcement.starts_at !== null && (
                      <span suppressHydrationWarning>
                        Starts {formatDateTime(announcement.starts_at)}
                      </span>
                    )}
                    {announcement.ends_at !== null && (
                      <span suppressHydrationWarning>
                        Ends {formatDateTime(announcement.ends_at)}
                      </span>
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
                      className="border-destructive/40 text-destructive hover:bg-destructive/10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </FilterSection>
    </div>
  )
}
