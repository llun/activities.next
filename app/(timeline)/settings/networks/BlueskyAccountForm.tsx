'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'

import {
  checkBlueskyHandle,
  linkBlueskyAppPassword,
  setBlueskyInstanceHandle,
  startBlueskySignIn,
  unlinkBlueskyAccount
} from '@/lib/client'
import { ConfirmDialog } from '@/lib/components/photo-editor/ConfirmDialog'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow, formRowHintId } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import {
  type BlueskyAccountState,
  type BlueskyHandleCheck,
  getBlueskyDnsRecord
} from '@/lib/utils/blueskyAccount'

// What the OAuth callback redirect (`?bluesky=`) reports.
const CALLBACK_NOTICES: Record<
  string,
  { tone: 'success' | 'error'; title: string }
> = {
  linked: { tone: 'success', title: 'Bluesky account linked.' },
  did_taken: {
    tone: 'error',
    title:
      'This Bluesky account is already linked to another profile on this server.'
  },
  failed: {
    tone: 'error',
    title: 'Bluesky sign-in did not finish. Please try again.'
  }
}

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : 'Something went wrong. Please try again.'

export const BlueskyAccountForm = ({
  initialState,
  callbackResult
}: {
  initialState: BlueskyAccountState
  callbackResult?: string | null
}) => {
  const router = useRouter()
  const [state, setState] = useState(initialState)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [useAppPassword, setUseAppPassword] = useState(
    !initialState.oauthAvailable
  )
  const [check, setCheck] = useState<BlueskyHandleCheck | null>(null)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  useEffect(() => {
    setState(initialState)
  }, [initialState])
  // The sign-in result belongs to the page load; any later action replaces it.
  const [showNotice, setShowNotice] = useState(true)
  const notice =
    showNotice && callbackResult ? CALLBACK_NOTICES[callbackResult] : undefined

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name)
    setError('')
    setShowNotice(false)
    try {
      await action()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const applyState = (next: BlueskyAccountState) => {
    setState(next)
    setCheck(null)
    router.refresh()
  }

  const submitLink = (event: FormEvent) => {
    event.preventDefault()
    if (useAppPassword) {
      void run('link', async () => {
        applyState(await linkBlueskyAppPassword(handle, password))
        setPassword('')
      })
      return
    }
    void run('link', async () => {
      // Leaves the page for the account's Bluesky server; it comes back to
      // the callback, which returns here with `?bluesky=`.
      window.location.assign(await startBlueskySignIn(handle))
    })
  }

  const account = state.account
  const alerts = (
    <>
      {notice && !error ? (
        <Alert tone={notice.tone} title={notice.title} />
      ) : null}
      {error ? <Alert title={error} /> : null}
      {account && !account.sessionActive ? (
        <Alert tone="warning" title="Bluesky ended this session.">
          Unlink the account and link it again to keep using it here.
        </Alert>
      ) : null}
    </>
  )

  if (!account) {
    return (
      <div className="space-y-4">
        {alerts}
        <Frame form>
          <form onSubmit={submitLink}>
            <FormRow
              label="Handle"
              htmlFor="bluesky-handle"
              hint="Your handle or DID, on bsky.social or any other server."
            >
              <div className="flex flex-wrap gap-2">
                <Input
                  id="bluesky-handle"
                  aria-describedby={formRowHintId('bluesky-handle')}
                  className="min-w-0 flex-1 basis-48"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="alice.bsky.social"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  required
                />
                {useAppPassword ? null : (
                  <Button type="submit" disabled={busy !== null}>
                    {busy === 'link'
                      ? 'Opening Bluesky…'
                      : 'Sign in with Bluesky'}
                  </Button>
                )}
              </div>
            </FormRow>
            {useAppPassword ? (
              <FormRow
                label="App password"
                htmlFor="bluesky-app-password"
                hint="Create one in Bluesky under Settings › Privacy and security › App passwords. Never your main password."
              >
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="bluesky-app-password"
                    aria-describedby={formRowHintId('bluesky-app-password')}
                    className="min-w-0 flex-1 basis-48 font-mono"
                    type="password"
                    autoComplete="off"
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <Button type="submit" disabled={busy !== null}>
                    {busy === 'link' ? 'Linking…' : 'Link account'}
                  </Button>
                </div>
              </FormRow>
            ) : null}
            {state.oauthAvailable ? (
              <FormRow
                label={
                  useAppPassword ? 'Bluesky sign-in' : 'No Bluesky sign-in?'
                }
              >
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0"
                  onClick={() => {
                    setUseAppPassword(!useAppPassword)
                    setError('')
                  }}
                >
                  {useAppPassword
                    ? 'Sign in with Bluesky instead'
                    : 'Use an app password instead'}
                </Button>
              </FormRow>
            ) : null}
          </form>
        </Frame>
      </div>
    )
  }

  const dnsRecord = getBlueskyDnsRecord(account.handle, account.did)
  const instance = state.instanceHandle

  return (
    <div className="space-y-4">
      {alerts}
      <Frame form>
        <FormRow label="Account">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a
              className="min-w-0 font-medium break-all underline"
              href={`https://bsky.app/profile/${account.did}`}
            >
              {account.handle}
            </a>
            <Badge>
              {account.authType === 'oauth' ? 'OAuth' : 'App password'}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={busy !== null}
              onClick={() => setConfirmUnlink(true)}
            >
              Unlink
            </Button>
          </div>
        </FormRow>
        <FormRow label="DID">
          <code className="text-xs break-all">{account.did}</code>
        </FormRow>
        <FormRow label="Server" hint="The PDS that holds this account.">
          <code className="text-xs break-all">{account.pdsUrl}</code>
        </FormRow>
        <FormRow
          label="Handle check"
          hint={
            account.domainHandle
              ? 'A handle on your own domain needs this TXT record at your DNS host.'
              : undefined
          }
        >
          <div className="space-y-2 text-sm">
            {account.domainHandle ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="min-w-0">
                  <code className="text-xs break-all">{dnsRecord.name}</code>
                </dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd>
                  <code className="text-xs">TXT</code>
                </dd>
                <dt className="text-muted-foreground">Value</dt>
                <dd className="min-w-0">
                  <code className="text-xs break-all">{dnsRecord.value}</code>
                </dd>
              </dl>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void run('check', async () => {
                    const result = await checkBlueskyHandle()
                    setCheck(result)
                    router.refresh()
                  })
                }
              >
                {busy === 'check' ? 'Checking…' : 'Check handle'}
              </Button>
              <span
                className="flex flex-wrap items-center gap-2"
                role="status"
                aria-live="polite"
              >
                {check ? (
                  <>
                    <Badge tone={check.verified ? 'success' : 'warning'}>
                      {check.verified ? 'Verified' : 'Not verified'}
                    </Badge>
                    {account.domainHandle ? (
                      <span className="text-muted-foreground">
                        {check.dnsRecord === null
                          ? 'DNS could not be checked'
                          : check.dnsRecord
                            ? 'DNS record found'
                            : 'No DNS record found yet'}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </span>
            </div>
          </div>
        </FormRow>
        {instance ? (
          <FormRow
            label="Server handle"
            hint={`Answer for ${instance.host}, so it can be your Bluesky handle.`}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {instance.status === 'taken' ? (
                <span className="text-muted-foreground">
                  Another profile answers for {instance.host}.
                </span>
              ) : (
                <>
                  {instance.status === 'yours' ? (
                    <span>
                      This server answers for {instance.host}. Set it as your
                      handle in your Bluesky app.
                    </span>
                  ) : null}
                  {instance.status === 'inactive' ? (
                    <span className="text-muted-foreground">
                      Your claim on {instance.host} is not in use: only an
                      admin’s profile on that domain can hold it.
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('instance', async () =>
                        applyState(
                          await setBlueskyInstanceHandle(
                            instance.status === 'free'
                          )
                        )
                      )
                    }
                  >
                    {instance.status === 'free'
                      ? `Use ${instance.host}`
                      : instance.status === 'yours'
                        ? 'Stop answering'
                        : 'Let it go'}
                  </Button>
                </>
              )}
            </div>
          </FormRow>
        ) : null}
      </Frame>
      <ConfirmDialog
        open={confirmUnlink}
        title="Unlink this Bluesky account?"
        description="This server forgets the account and its session. Your Bluesky account, posts and followers stay as they are."
        cancelLabel="Cancel"
        confirmLabel="Unlink"
        destructive
        onCancel={() => setConfirmUnlink(false)}
        onConfirm={() => {
          setConfirmUnlink(false)
          void run('unlink', async () =>
            applyState(await unlinkBlueskyAccount())
          )
        }}
      />
    </div>
  )
}
