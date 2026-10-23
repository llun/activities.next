'use client'

import { Check, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { FC, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { CustomEmojiTextProps } from '@/lib/components/actors/ActorDisplayName'
import { ProfileFieldsBlock } from '@/lib/components/profile/ProfileFieldsBlock'
import { chooseProfileFieldIcon } from '@/lib/components/profile/profileFieldIcon'
import { PROFILE_FIELD_ICONS } from '@/lib/components/profile/profileFieldIcons'
import { PROFILE_FIELDS_FIRST_CONTROL_ID } from '@/lib/components/settings/profileFieldsFieldIds'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import {
  PROFILE_FIELD_LIMIT,
  PROFILE_FIELD_NAME_MAX_LENGTH,
  PROFILE_FIELD_VALUE_MAX_LENGTH
} from '@/lib/services/accounts/profileFieldLimits'
import { cn } from '@/lib/utils'
import {
  formatProfileFieldValue,
  getProfileFieldHttpsUrl
} from '@/lib/utils/text/formatProfileFieldValue'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

export const PROFILE_FIELD_ERROR =
  'Fill in both the label and the content, or clear both.'

interface Props {
  /** The saved fields; `verifiedAt` (epoch ms) is set once the link was checked. */
  fields: { name: string; value: string; verifiedAt?: number | null }[]
  /** The public profile URL, shown in the `rel="me"` snippet. */
  profileUrl: string
  /** The row's hint id (the `FormRow` render prop), read by every input. */
  describedBy?: string
  /** The row's label id (the `FormRow` render prop), naming the group. */
  labelledBy?: string
  /** The actor's custom emoji, so the preview shows shortcodes as images. */
  tags?: CustomEmojiTextProps['tags']
  /**
   * Called with the rows (label and content, as typed) whenever they change, so
   * an editor that keeps the profile in its own state can compare them with
   * what was saved and draw a live preview. Not called for the rows it starts
   * with.
   */
  onRowsChange?: (rows: { name: string; value: string }[]) => void
  /**
   * The "On your profile" preview under the rows. On by default; a page that
   * draws its own live preview turns it off.
   */
  showPreview?: boolean
  /**
   * Show "Checking for a link back to your profile…" for a link that was
   * changed or added and not saved yet, and for the links in `pendingValues`.
   * The Edit profile page turns it on; the label is client-only state, the
   * server does not say when a check is running.
   */
  showLinkChecks?: boolean
  /**
   * Link values (trimmed) that were just saved and have not been checked yet,
   * so the page can say a check is on its way. Needs `showLinkChecks`.
   */
  pendingValues?: string[]
}

interface Row {
  /** Stable across moves and removals, so React and focus follow the row. */
  id: number
  name: string
  value: string
}

type PendingFocus =
  | { kind: 'name'; id: number }
  | { kind: 'value'; id: number }
  | { kind: 'move'; id: number; direction: 'up' | 'down' }
  | { kind: 'chip' }

const SUGGESTIONS = [
  { label: 'Location', icon: 'location' },
  { label: 'Pronouns', icon: 'text' },
  { label: 'Website', icon: 'link' },
  { label: 'Email', icon: 'mail' },
  { label: 'Strava', icon: 'activity' },
  { label: 'Photos', icon: 'image' }
] as const

const isHalfFilled = (row: { name: string; value: string }) =>
  (row.name.trim() === '') !== (row.value.trim() === '')

// Touch targets: 44px on a phone and under a coarse pointer.
const TOUCH_SIZE = 'max-sm:size-11 pointer-coarse:size-11'
const TOUCH_HEIGHT = 'max-sm:h-11 pointer-coarse:h-11'

/**
 * The control column of the settings "Profile fields" row. Only filled or
 * added fields show as rows (0 to 4); suggestion chips add a row with its label
 * filled in. The form always submits four `fields[i][name]` / `fields[i][value]`
 * pairs in row order (unused slots as empty hidden inputs), because the server
 * keeps the stored fields when a form sends no field keys at all, so emptying
 * the list must still send something. A half-filled row blocks the native
 * submit through the browser's own validation and says why under the row; the
 * route checks the same rule again.
 */
export const ProfileFieldsField: FC<Props> = ({
  fields,
  profileUrl,
  describedBy,
  labelledBy,
  tags,
  onRowsChange,
  showPreview = true,
  showLinkChecks = false,
  pendingValues
}) => {
  const chipsLabelId = useId()
  const nextId = useRef(0)
  const [rows, setRows] = useState<Row[]>(() =>
    fields
      .filter((field) => field.name.trim() !== '' || field.value.trim() !== '')
      .slice(0, PROFILE_FIELD_LIMIT)
      .map((field) => ({
        id: nextId.current++,
        name: field.name,
        value: field.value
      }))
  )
  // A row's error shows once the person has left it or tried to submit. A
  // half-filled row saved earlier (update_credentials allows one) shows it from
  // the start, so the person sees why Save is blocked.
  const [shown, setShown] = useState<Set<number>>(
    () => new Set(rows.filter(isHalfFilled).map((row) => row.id))
  )
  const nameRefs = useRef(new Map<number, HTMLInputElement | null>())
  const valueRefs = useRef(new Map<number, HTMLInputElement | null>())
  const upRefs = useRef(new Map<number, HTMLButtonElement | null>())
  const downRefs = useRef(new Map<number, HTMLButtonElement | null>())
  const firstChipRef = useRef<HTMLButtonElement | null>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const edited = useRef(false)
  // Safari and Firefox on macOS do not focus a button on click, so pressing a
  // row's own button blurs its input with no relatedTarget. This marks that
  // press so the blur is not mistaken for leaving the row. It holds the id of
  // the row whose button is pressed, since another row's press says nothing
  // about this row's blur.
  const pressedRow = useRef<number | null>(null)

  useEffect(() => {
    rows.forEach((row) => {
      const message = isHalfFilled(row) ? PROFILE_FIELD_ERROR : ''
      // Mark the empty half, which is the one left to fill in.
      const empty = row.name.trim() === '' ? 'name' : 'value'
      nameRefs.current
        .get(row.id)
        ?.setCustomValidity(empty === 'name' ? message : '')
      valueRefs.current
        .get(row.id)
        ?.setCustomValidity(empty === 'value' ? message : '')
    })
  }, [rows])

  const rowsChangeRef = useRef(onRowsChange)
  rowsChangeRef.current = onRowsChange
  const reportedRows = useRef(rows)
  useEffect(() => {
    if (reportedRows.current === rows) return
    reportedRows.current = rows
    rowsChangeRef.current?.(
      rows.map((row) => ({ name: row.name, value: row.value }))
    )
  }, [rows])

  // Adding, moving and removing a row press buttons, which fire no `input` or
  // `change` event, so tell the form (its save bar enables Save from those) once
  // the rows are in the DOM.
  useEffect(() => {
    if (!edited.current) return
    edited.current = false
    groupRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [rows])

  // Focus moves after the render that creates, moves or drops the row.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    if (target.kind === 'chip') {
      firstChipRef.current?.focus()
    } else if (target.kind === 'name') {
      nameRefs.current.get(target.id)?.focus()
    } else if (target.kind === 'value') {
      valueRefs.current.get(target.id)?.focus()
    } else {
      const index = rows.findIndex((row) => row.id === target.id)
      // The button that was pressed is disabled once the row reaches an end.
      const direction =
        target.direction === 'up'
          ? index === 0
            ? 'down'
            : 'up'
          : index === rows.length - 1
            ? 'up'
            : 'down'
      ;(direction === 'up' ? upRefs : downRefs).current.get(target.id)?.focus()
    }
  }, [rows])

  const update = (id: number, change: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...change } : row))
    )
  const reveal = (id: number) =>
    setShown((current) =>
      current.has(id) ? current : new Set(current).add(id)
    )

  const add = (name: string) => {
    if (rows.length >= PROFILE_FIELD_LIMIT) return
    const id = nextId.current++
    edited.current = true
    pendingFocus.current = { kind: name ? 'value' : 'name', id }
    setRows([...rows, { id, name, value: '' }])
  }
  const remove = (index: number) => {
    edited.current = true
    const next = rows[index + 1] ?? rows[index - 1]
    pendingFocus.current = next
      ? { kind: 'name', id: next.id }
      : { kind: 'chip' }
    setRows(rows.filter((_, i) => i !== index))
  }
  const move = (index: number, direction: 'up' | 'down') => {
    const other = direction === 'up' ? index - 1 : index + 1
    if (other < 0 || other >= rows.length) return
    edited.current = true
    pendingFocus.current = { kind: 'move', id: rows[index].id, direction }
    const next = [...rows]
    ;[next[index], next[other]] = [next[other], next[index]]
    setRows(next)
  }

  // Saved https values by value (not by position, rows move): the verification
  // time of each, or null while it was never checked. A value shared by two
  // saved fields counts as verified when either was, as the server carries it.
  const saved = useMemo(() => {
    const byValue = new Map<string, number | null>()
    for (const field of fields) {
      const value = field.value.trim()
      if (!getProfileFieldHttpsUrl(value)) continue
      byValue.set(value, byValue.get(value) || field.verifiedAt || null)
    }
    return byValue
  }, [fields])

  const rowViews = useMemo(
    () =>
      rows.map((row) => {
        const value = row.value.trim()
        const icon = chooseProfileFieldIcon(
          row.name,
          sanitizeText(formatProfileFieldValue(row.value))
        ).kind
        // A status only for a content that is still a saved https value, or,
        // with link checks on, a https value a check is running or about to run
        // for: one just saved, or one changed or added and not saved yet.
        const isLink = Boolean(getProfileFieldHttpsUrl(value))
        const checking =
          showLinkChecks &&
          isLink &&
          ((pendingValues ?? []).includes(value) || !saved.has(value))
        const hasStatus = checking || saved.has(value)
        return {
          icon,
          hasStatus,
          checking,
          verifiedAt: hasStatus && !checking ? (saved.get(value) ?? null) : null
        }
      }),
    [rows, saved, showLinkChecks, pendingValues]
  )

  const previewFields = rows.flatMap((row, index) =>
    row.name.trim() && row.value.trim()
      ? [
          {
            name: row.name.trim(),
            value: formatProfileFieldValue(row.value),
            verifiedAt: rowViews[index].verifiedAt
              ? new Date(rowViews[index].verifiedAt).toISOString()
              : null
          }
        ]
      : []
  )

  const left = PROFILE_FIELD_LIMIT - rows.length

  return (
    <div
      ref={groupRef}
      role="group"
      aria-labelledby={labelledBy}
      className="space-y-2"
    >
      {rows.map((row, index) => {
        const { icon, hasStatus, checking, verifiedAt } = rowViews[index]
        const Icon = PROFILE_FIELD_ICONS[icon]
        const invalid = shown.has(row.id) && isHalfFilled(row)
        const errorId = `profileField${index}Error`
        const statusId = `profileField${index}Status`
        const verified = hasStatus && Boolean(verifiedAt)
        const inputDescribedBy =
          [describedBy, invalid ? errorId : null].filter(Boolean).join(' ') ||
          undefined
        const valueDescribedBy =
          [inputDescribedBy, hasStatus ? statusId : null]
            .filter(Boolean)
            .join(' ') || undefined
        // Always the position, like the inputs' names, so rows with the same
        // label stay apart.
        const label = row.name.trim()
        const fieldName = label
          ? `field ${index + 1}, ${label}`
          : `field ${index + 1}`
        return (
          <div key={row.id}>
            <div
              className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-2 sm:grid-cols-[1.25rem_7.75rem_minmax(0,1fr)_auto]"
              onPointerDown={(event) => {
                // A disabled button is never clicked, so nothing would clear it.
                pressedRow.current = (event.target as Element).closest(
                  'button:not(:disabled)'
                )
                  ? row.id
                  : null
              }}
              // The click ends the press: on iOS Safari the input blurs after
              // pointerup, so pointerup is too early to clear it.
              onClickCapture={() => {
                pressedRow.current = null
              }}
              onPointerCancel={() => {
                pressedRow.current = null
              }}
              // Focus entering the row means any earlier press is over, even
              // one released outside the row with nothing focused.
              onFocus={() => {
                pressedRow.current = null
              }}
              onBlur={(event) => {
                const pressed = pressedRow.current === row.id
                pressedRow.current = null
                // Moving within a row is not leaving it.
                if (event.currentTarget.contains(event.relatedTarget)) return
                if (pressed && event.relatedTarget === null) return
                reveal(row.id)
              }}
            >
              <Icon
                aria-hidden="true"
                data-slot="profile-field-icon"
                data-icon={icon}
                className="col-start-1 row-start-1 size-4 text-muted-foreground"
              />
              <Input
                ref={(node) => {
                  nameRefs.current.set(row.id, node)
                }}
                type="text"
                id={index === 0 ? PROFILE_FIELDS_FIRST_CONTROL_ID : undefined}
                name={`fields[${index}][name]`}
                aria-label={`Field ${index + 1} label`}
                placeholder="Label"
                maxLength={PROFILE_FIELD_NAME_MAX_LENGTH}
                value={row.name}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={inputDescribedBy}
                onChange={(event) =>
                  update(row.id, { name: event.target.value })
                }
                onInvalid={() => reveal(row.id)}
                className={cn(
                  'col-start-2 row-start-1 font-medium',
                  TOUCH_HEIGHT
                )}
              />
              <Input
                ref={(node) => {
                  valueRefs.current.set(row.id, node)
                }}
                type="text"
                name={`fields[${index}][value]`}
                aria-label={`Field ${index + 1} content`}
                placeholder="https://… or text"
                maxLength={PROFILE_FIELD_VALUE_MAX_LENGTH}
                value={row.value}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={valueDescribedBy}
                onChange={(event) =>
                  update(row.id, { value: event.target.value })
                }
                onInvalid={() => reveal(row.id)}
                className={cn(
                  'col-span-3 col-start-1 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1',
                  TOUCH_HEIGHT
                )}
              />
              <div className="col-start-3 row-start-1 flex items-center sm:col-start-4">
                <Button
                  ref={(node) => {
                    upRefs.current.set(row.id, node)
                  }}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${fieldName} up`}
                  disabled={index === 0}
                  onClick={() => move(index, 'up')}
                  className={cn('text-muted-foreground', TOUCH_SIZE)}
                >
                  <ChevronUp aria-hidden="true" />
                </Button>
                <Button
                  ref={(node) => {
                    downRefs.current.set(row.id, node)
                  }}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${fieldName} down`}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 'down')}
                  className={cn('text-muted-foreground', TOUCH_SIZE)}
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${fieldName}`}
                  onClick={() => remove(index)}
                  className={cn('text-muted-foreground', TOUCH_SIZE)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
            {hasStatus ? (
              <p
                id={statusId}
                data-slot="profile-link-status"
                className={cn(
                  'mt-1.5 flex items-center gap-1 text-xs sm:pl-[calc(1.25rem+7.75rem+0.75rem)]',
                  verified
                    ? 'font-medium text-success-text'
                    : 'text-muted-foreground'
                )}
              >
                {verified ? (
                  <Check aria-hidden="true" className="size-3.5 shrink-0" />
                ) : null}
                {checking
                  ? 'Checking for a link back to your profile…'
                  : verified
                    ? 'Verified'
                    : 'Not verified'}
              </p>
            ) : null}
            {invalid ? (
              <p
                id={errorId}
                role="alert"
                className="mt-1.5 text-xs text-destructive-text sm:pl-[calc(1.25rem+7.75rem+0.75rem)]"
              >
                {PROFILE_FIELD_ERROR}
              </p>
            ) : null}
          </div>
        )
      })}
      {/* Always four pairs, so removing every field clears them on save. */}
      {Array.from(
        { length: PROFILE_FIELD_LIMIT - rows.length },
        (_, offset) => rows.length + offset
      ).map((index) => (
        <span key={`empty-${index}`} hidden>
          <input type="hidden" name={`fields[${index}][name]`} value="" />
          <input type="hidden" name={`fields[${index}][value]`} value="" />
        </span>
      ))}
      {left > 0 ? (
        <div className="space-y-2 pt-1">
          <p id={chipsLabelId} className="text-xs text-muted-foreground">
            Add a field · {left} left
          </p>
          <div
            role="group"
            aria-labelledby={chipsLabelId}
            className="flex flex-wrap gap-2"
          >
            {SUGGESTIONS.map(({ label, icon }, chipIndex) => {
              const Icon = PROFILE_FIELD_ICONS[icon]
              return (
                <Button
                  key={label}
                  ref={chipIndex === 0 ? firstChipRef : undefined}
                  type="button"
                  variant="pill"
                  size="sm"
                  onClick={() => add(label)}
                  className={TOUCH_HEIGHT}
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                  {label}
                </Button>
              )
            })}
            <Button
              type="button"
              variant="pill"
              size="sm"
              onClick={() => add('')}
              className={cn('border-dashed', TOUCH_HEIGHT)}
            >
              <Plus aria-hidden="true" className="size-3.5" />
              Custom field
            </Button>
          </div>
        </div>
      ) : null}
      {showPreview ? (
        <div
          data-slot="profile-fields-preview"
          className="rounded-lg border bg-background px-3.5 py-3"
        >
          <p className="text-xs font-semibold text-muted-foreground">
            On your profile
          </p>
          {previewFields.length > 0 ? (
            <div className="-mt-1">
              <ProfileFieldsBlock fields={previewFields} tags={tags} />
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing to show yet.
            </p>
          )}
        </div>
      ) : null}
      <p className="pt-1 text-xs text-muted-foreground">
        To get a check mark next to a link, add a link back to your profile with{' '}
        {'rel="me"'} on that page.
      </p>
      <code className="block rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all">
        {`<a rel="me" href="${profileUrl}">Activities.next</a>`}
      </code>
    </div>
  )
}
