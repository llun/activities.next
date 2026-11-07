'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { updateBlueskySharing } from '@/lib/client'
import { ConfirmDialog } from '@/lib/components/photo-editor/ConfirmDialog'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SavedIndicator } from '@/lib/components/surface/SaveBar'
import { Switch } from '@/lib/components/ui/switch'
import type { BlueskySharingState } from '@/lib/utils/blueskySharing'

export const BlueskySharingForm = ({
  initialState
}: {
  initialState: BlueskySharingState
}) => {
  const router = useRouter()
  const [state, setState] = useState(initialState)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)
  useEffect(() => {
    setState(initialState)
  }, [initialState])
  const enabled = state.status !== 'Off'
  const reasons = [
    ...state.requirements,
    ...(!state.federationAllowed
      ? ['This instance does not federate with bsky.brid.gy.']
      : [])
  ]

  const save = async (next: boolean) => {
    setConfirmOff(false)
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      setState(await updateBlueskySharing(next))
      setSaved(true)
      router.refresh()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to update Bluesky sharing. Please try again.'
      )
      // A remote failure can occur after a local relationship was written.
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Alert title={error} /> : null}
      <Frame form>
        <FormRow
          label="Share my posts on Bluesky"
          htmlFor="bluesky-sharing"
          inline
          hint={
            <>
              Only fully public posts are copied; replies cross only to bridged
              posts; long posts are shortened to 300 characters.
            </>
          }
        >
          {({ describedBy }) => (
            <Switch
              id="bluesky-sharing"
              aria-describedby={
                reasons.length
                  ? `${describedBy} bluesky-sharing-requirements`
                  : describedBy
              }
              checked={enabled}
              disabled={saving || (!enabled && reasons.length > 0)}
              onCheckedChange={(next) =>
                next ? void save(true) : setConfirmOff(true)
              }
            />
          )}
        </FormRow>
        <FormRow label="Status">
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-2 text-sm"
            aria-live="polite"
          >
            {state.status}
            {state.status === 'On' ? (
              <>
                {' '}
                ·{' '}
                <a
                  className="underline"
                  href={`https://bsky.app/profile/${state.handle}`}
                >
                  {state.handle}
                </a>
              </>
            ) : null}
            {saving ? ' · Saving…' : null}
            <SavedIndicator saved={saved} announce={false} />
          </div>
        </FormRow>
        {reasons.length ? (
          <FormRow label="Requirements">
            <div
              id="bluesky-sharing-requirements"
              className="space-y-1 text-sm text-muted-foreground"
            >
              {reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
              <a className="underline" href="https://fed.brid.gy/docs">
                Bridgy Fed requirements
              </a>
            </div>
          </FormRow>
        ) : null}
        <p className="px-4 py-2.5 text-sm text-muted-foreground">
          To follow someone on Bluesky, search for their handle, like
          alice.bsky.social.
        </p>
      </Frame>
      <ConfirmDialog
        open={confirmOff}
        title="Turn off Bluesky sharing?"
        description="Your Bluesky copy and its followers will be removed."
        cancelLabel="Cancel"
        confirmLabel="Turn off"
        destructive
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => void save(false)}
      />
    </div>
  )
}
