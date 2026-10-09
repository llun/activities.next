'use client'

import { Plus, Trash2 } from 'lucide-react'
import { FC, FormEvent, useCallback, useEffect, useState } from 'react'

import {
  type ServerAnnouncement,
  type ServerAnnouncementInput,
  createServerAnnouncement,
  deleteServerAnnouncement,
  getServerAnnouncements,
  updateServerAnnouncement
} from '@/lib/client'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FormRow, formRowHintId } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { SkeletonRows } from '@/lib/components/surface/Skeleton'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'

import {
  type AnnouncementStatusDescriptor,
  computeAnnouncementStatus
} from './announcementStatus'

const STATUS_TONES: Record<
  AnnouncementStatusDescriptor['tone'],
  'success' | 'primary' | 'gray'
> = {
  green: 'success',
  orange: 'primary',
  gray: 'gray'
}

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

  const loadAnnouncements = useCallback(() => {
    let active = true
    setLoading(true)
    setListError(null)
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

  useEffect(() => loadAnnouncements(), [loadAnnouncements])

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

      {listError && (
        <Alert
          title={listError}
          // A failed load offers another go; a failed write does not need one.
          onRetry={announcements.length === 0 ? loadAnnouncements : undefined}
        />
      )}

      <Section
        title="Add an announcement"
        description="Markdown is supported. Leave the event window empty to show it immediately and indefinitely."
      >
        <form onSubmit={handleCreate} className="space-y-3">
          <Frame
            divided
            footer={
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    saving || busyId !== null || newText.trim().length === 0
                  }
                >
                  <Plus />
                  {newPublished ? 'Publish' : 'Save draft'}
                </Button>
              </div>
            }
          >
            <FormRow
              label="Text"
              htmlFor="announcement-text"
              hint="Markdown with hashtags and mentions; keep it under a few sentences. No attachments."
              wide
            >
              {({ describedBy }) => (
                <Textarea
                  id="announcement-text"
                  value={newText}
                  onChange={(event) => setNewText(event.target.value)}
                  maxLength={5000}
                  rows={4}
                  required
                  aria-describedby={describedBy}
                />
              )}
            </FormRow>
            <FormRow label="Event starts" htmlFor="announcement-starts-at">
              <Input
                id="announcement-starts-at"
                type="datetime-local"
                value={newStartsAt}
                onChange={(event) => setNewStartsAt(event.target.value)}
              />
            </FormRow>
            <FormRow label="Event ends" htmlFor="announcement-ends-at">
              <Input
                id="announcement-ends-at"
                type="datetime-local"
                value={newEndsAt}
                onChange={(event) => setNewEndsAt(event.target.value)}
                disabled={newAllDay}
              />
            </FormRow>
            <FormRow
              inline
              label="All-day event"
              htmlFor="announcement-all-day"
              hint="Hide the times and show only the dates."
            >
              <Switch
                id="announcement-all-day"
                aria-describedby={formRowHintId('announcement-all-day')}
                checked={newAllDay}
                onCheckedChange={setNewAllDay}
              />
            </FormRow>
            <FormRow
              inline
              label="Publish now"
              htmlFor="announcement-published"
              hint="Publish immediately. Leave off to save as a draft."
            >
              <Switch
                id="announcement-published"
                aria-describedby={formRowHintId('announcement-published')}
                checked={newPublished}
                onCheckedChange={setNewPublished}
              />
            </FormRow>
          </Frame>
          <p className="text-muted-foreground text-xs">
            Times are stored in UTC and display in each reader&apos;s local
            timezone. The announcement disappears for everyone after the end
            date.
          </p>
          {formError && <Alert title={formError} />}
        </form>
      </Section>

      <Section
        title="Existing announcements"
        meta={announcements.length > 0 ? announcements.length : undefined}
      >
        {loading ? (
          <Frame className="p-4">
            <SkeletonRows
              rows={3}
              rowClassName="h-16"
              label="Loading announcements"
            />
          </Frame>
        ) : announcements.length === 0 && !listError ? (
          // Suppress the empty-state copy when a load error is already shown, so
          // a failed fetch doesn't read as "you have no announcements".
          <EmptyState
            icon={ADMIN_ICONS.announcements}
            title="No announcements yet"
          >
            Add one above to show it to everyone.
          </EmptyState>
        ) : announcements.length > 0 ? (
          <FramedList aria-label="Announcements">
            {announcements.map((announcement) => {
              const status = computeAnnouncementStatus(
                announcement,
                currentTime
              )
              return (
                <FramedListItem key={announcement.id} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <Badge tone={STATUS_TONES[status.tone]}>
                      {status.label}
                    </Badge>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      {announcement.starts_at !== null && (
                        <span>
                          Starts {formatDateTime(announcement.starts_at)}
                        </span>
                      )}
                      {announcement.ends_at !== null && (
                        <span>Ends {formatDateTime(announcement.ends_at)}</span>
                      )}
                      {announcement.all_day && <span>All day</span>}
                    </div>
                  </div>
                  <div>
                    <Label
                      htmlFor={`announcement-text-${announcement.id}`}
                      className="sr-only"
                    >
                      Text
                    </Label>
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
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Delete announcement ${announcement.text}`}
                      onClick={() => handleDelete(announcement)}
                      disabled={busyId !== null || saving}
                      className="border-destructive/40 text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </FramedListItem>
              )
            })}
          </FramedList>
        ) : null}
      </Section>
    </div>
  )
}
