'use client'

import { FC, useEffect, useRef, useState } from 'react'

import { Input } from '@/lib/components/ui/input'
import {
  PROFILE_FIELD_LIMIT,
  PROFILE_FIELD_NAME_MAX_LENGTH,
  PROFILE_FIELD_VALUE_MAX_LENGTH
} from '@/lib/services/accounts/profileFieldLimits'

export const PROFILE_LINK_ERROR =
  'Fill in both the label and the content, or clear both.'

interface Props {
  fields: { name: string; value: string }[]
  /** The public profile URL, shown in the `rel="me"` snippet. */
  profileUrl: string
  /** The row's hint id (the `FormRow` render prop), read by every input. */
  describedBy?: string
  /** The row's label id (the `FormRow` render prop), naming the group. */
  labelledBy?: string
}

interface Row {
  name: string
  value: string
}

const isHalfFilled = (row: Row) =>
  (row.name.trim() === '') !== (row.value.trim() === '')

/**
 * The control column of the settings "Profile links" row: four label/content
 * pairs inside the profile form (no delete buttons: a row with both inputs
 * empty is dropped on save). A half-filled row blocks the native submit
 * through the browser's own validation and says why under the row; the route
 * checks the same rule again.
 */
export const ProfileLinksField: FC<Props> = ({
  fields,
  profileUrl,
  describedBy,
  labelledBy
}) => {
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: PROFILE_FIELD_LIMIT }, (_, index) => ({
      name: fields[index]?.name ?? '',
      value: fields[index]?.value ?? ''
    }))
  )
  // A row's error shows once the person has left it or tried to submit. A
  // half-filled row saved earlier (update_credentials allows one) shows it from
  // the start, so the person sees why Save is blocked.
  const [shown, setShown] = useState<boolean[]>(() =>
    rows.map((row) => isHalfFilled(row))
  )
  const nameRefs = useRef<(HTMLInputElement | null)[]>([])
  const valueRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    rows.forEach((row, index) => {
      const message = isHalfFilled(row) ? PROFILE_LINK_ERROR : ''
      // Mark the empty half, which is the one left to fill in.
      const empty = row.name.trim() === '' ? 'name' : 'value'
      nameRefs.current[index]?.setCustomValidity(
        empty === 'name' ? message : ''
      )
      valueRefs.current[index]?.setCustomValidity(
        empty === 'value' ? message : ''
      )
    })
  }, [rows])

  const update = (index: number, change: Partial<Row>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...change } : row))
    )
  const reveal = (index: number) =>
    setShown((current) => current.map((flag, i) => flag || i === index))

  return (
    <div role="group" aria-labelledby={labelledBy} className="space-y-2">
      {rows.map((row, index) => {
        const invalid = shown[index] && isHalfFilled(row)
        const errorId = `profileField${index}Error`
        const inputDescribedBy =
          [describedBy, invalid ? errorId : null].filter(Boolean).join(' ') ||
          undefined
        return (
          <div key={index}>
            <div
              className="grid grid-cols-2 gap-2"
              onBlur={(event) => {
                // Moving from a row's label to its content is not leaving it.
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  reveal(index)
                }
              }}
            >
              <Input
                ref={(node) => {
                  nameRefs.current[index] = node
                }}
                type="text"
                id={`profileField${index}Name`}
                name={`fields[${index}][name]`}
                aria-label={`Link ${index + 1} label`}
                placeholder="Label"
                maxLength={PROFILE_FIELD_NAME_MAX_LENGTH}
                value={row.name}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={inputDescribedBy}
                onChange={(event) =>
                  update(index, { name: event.target.value })
                }
                onInvalid={() => reveal(index)}
              />
              <Input
                ref={(node) => {
                  valueRefs.current[index] = node
                }}
                type="text"
                name={`fields[${index}][value]`}
                aria-label={`Link ${index + 1} content`}
                placeholder="https://… or text"
                maxLength={PROFILE_FIELD_VALUE_MAX_LENGTH}
                value={row.value}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={inputDescribedBy}
                onChange={(event) =>
                  update(index, { value: event.target.value })
                }
                onInvalid={() => reveal(index)}
              />
            </div>
            {invalid ? (
              <p
                id={errorId}
                role="alert"
                className="mt-1.5 text-xs text-destructive-text"
              >
                {PROFILE_LINK_ERROR}
              </p>
            ) : null}
          </div>
        )
      })}
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
