'use client'

import { useCallback, useState } from 'react'

import {
  AdminServerSettingsResponse,
  updateAdminServerSettings
} from '@/lib/client'

// A settings form keyed by dotted setting keys (e.g. `instance.name`). Sections
// save independently: each SaveBar drives its own saving/saved/error status and
// patches only its keys, matching the design where every section has its own
// Update button.

type Values = Record<string, unknown>

export interface SectionStatus {
  saving: boolean
  saved: boolean
  error: string | null
}

const IDLE: SectionStatus = { saving: false, saved: false, error: null }

const getByPath = (source: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value == null ? undefined : (value as Record<string, unknown>)[key],
      source
    )

const valuesEqual = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)

export const useServerSettingsForm = (initial: Values) => {
  const [values, setValues] = useState<Values>(initial)
  const [baseline, setBaseline] = useState<Values>(initial)
  const [statuses, setStatuses] = useState<Record<string, SectionStatus>>({})

  const setValue = useCallback((key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }))
  }, [])

  const isDirty = useCallback(
    (keys: string[]) =>
      keys.some((key) => !valuesEqual(values[key], baseline[key])),
    [values, baseline]
  )

  const statusFor = useCallback(
    (id: string): SectionStatus => statuses[id] ?? IDLE,
    [statuses]
  )

  const saveSection = useCallback(
    async (id: string, keys: string[]) => {
      setStatuses((current) => ({
        ...current,
        [id]: { saving: true, saved: false, error: null }
      }))

      const patch: Values = {}
      keys.forEach((key) => {
        patch[key] = values[key]
      })

      try {
        const result: AdminServerSettingsResponse =
          await updateAdminServerSettings(patch)
        // Adopt the server-resolved values (e.g. normalized emails) as both the
        // live value and the new baseline so the section reads as saved.
        const resolved: Values = {}
        keys.forEach((key) => {
          resolved[key] = getByPath(result.settings, key)
        })
        setValues((current) => ({ ...current, ...resolved }))
        setBaseline((current) => ({ ...current, ...resolved }))
        setStatuses((current) => ({
          ...current,
          [id]: { saving: false, saved: true, error: null }
        }))
      } catch (error) {
        setStatuses((current) => ({
          ...current,
          [id]: {
            saving: false,
            saved: false,
            error: error instanceof Error ? error.message : 'Failed to save'
          }
        }))
      }
    },
    [values]
  )

  return { values, setValue, isDirty, statusFor, saveSection }
}
