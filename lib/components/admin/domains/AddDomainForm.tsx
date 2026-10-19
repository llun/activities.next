'use client'

import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, FormEvent, useState } from 'react'

import {
  AdminDomainRequestError,
  addAdminDomain,
  checkAdminDomain,
  setAdminDomainStatus
} from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow, formRowHintId } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import type { AdminDomain } from '@/lib/services/domains/adminDomainTypes'

import { DomainCheckItems } from './DomainCheckItems'
import { domainSettingsHref } from './domainLabels'

const INPUT_ID = 'add-domain'

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

/**
 * Admin › Domains › Add domain. One box that walks through the states of the
 * design: ready, checking, check failed (what to fix, then Check again) and
 * check passed (Turn on, or open the domain's settings). The domain is saved
 * as off by the first check, whatever its result.
 */
export const AddDomainForm: FC = () => {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [added, setAdded] = useState<AdminDomain | null>(null)
  const [busy, setBusy] = useState<'checking' | 'turning-on' | null>(null)
  const [error, setError] = useState<{
    title: string
    action: 'check' | 'turn-on'
  } | null>(null)

  // Typing another domain after a check starts over with that one.
  const current =
    added && value.trim().toLowerCase() === added.domain ? added : null
  const check = current?.lastCheck ?? null
  const checking = busy === 'checking'
  const target = current?.domain ?? value.trim()

  const runCheck = async () => {
    setBusy('checking')
    setError(null)
    try {
      const domain = current
        ? await checkAdminDomain(current.domain)
        : await addAdminDomain(value).catch((caught: unknown) => {
            // Added before (another tab, a reload): check that row again.
            if (
              caught instanceof AdminDomainRequestError &&
              caught.code === 'exists'
            ) {
              return checkAdminDomain(value.trim())
            }
            throw caught
          })
      setAdded(domain)
      setValue(domain.domain)
    } catch (caught) {
      setError({
        title: errorMessage(caught, 'Failed to check the domain.'),
        action: 'check'
      })
    } finally {
      setBusy(null)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!busy && value.trim()) void runCheck()
  }

  const turnOn = async () => {
    if (!current) return
    setBusy('turning-on')
    setError(null)
    try {
      const domain = await setAdminDomainStatus(current.domain, 'on')
      router.push(domainSettingsHref(domain.domain))
      router.refresh()
    } catch (caught) {
      if (caught instanceof AdminDomainRequestError && caught.domain) {
        setAdded(caught.domain)
      }
      setError({
        title: errorMessage(caught, 'Failed to turn the domain on.'),
        action: 'turn-on'
      })
      setBusy(null)
    }
  }

  const passed = Boolean(check?.passed) && !checking
  const failed = Boolean(check && !check.passed) && !checking

  const footer = passed ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Badge tone="gray">Off</Badge>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={domainSettingsHref(target)}>Open domain settings</Link>
        </Button>
        <Button
          type="button"
          onClick={() => void turnOn()}
          disabled={busy !== null}
        >
          {busy === 'turning-on' ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : null}
          Turn on {target}
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground min-w-0 text-sm">
        {checking
          ? null
          : failed
            ? 'Fix the items above, then check again.'
            : 'The domain is added as Off.'}
      </p>
      <Button
        type="submit"
        className="ml-auto"
        disabled={busy !== null || !value.trim()}
      >
        {checking ? (
          <>
            <Loader2 aria-hidden="true" className="animate-spin" />
            Checking…
          </>
        ) : failed ? (
          'Check again'
        ) : (
          'Check domain'
        )}
      </Button>
    </div>
  )

  return (
    <form onSubmit={onSubmit} noValidate>
      <Frame form className="overflow-hidden" footer={footer}>
        <FormRow
          label="Domain"
          htmlFor={INPUT_ID}
          hint={
            check
              ? undefined
              : 'Point DNS and your proxy at this server first. We check that the domain reaches this server before adding it.'
          }
        >
          <Input
            id={INPUT_ID}
            name="domain"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="photos.example"
            value={value}
            maxLength={255}
            disabled={busy !== null}
            aria-invalid={failed || Boolean(error) || undefined}
            aria-describedby={check ? undefined : formRowHintId(INPUT_ID)}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormRow>

        {error ? (
          <div className="px-4 py-2.5">
            <Alert
              title={error.title}
              onRetry={() =>
                void (error.action === 'check' ? runCheck() : turnOn())
              }
            />
          </div>
        ) : null}

        {checking ? (
          <div className="px-4 py-2.5">
            <Alert tone="info" title={`Checking ${target}`}>
              Asking {target} for this server. This takes a few seconds.
            </Alert>
          </div>
        ) : failed && check && current ? (
          <div className="px-4 py-2.5">
            <Alert
              tone="error"
              title={`${current.domain} does not reach this server yet`}
            >
              <DomainCheckItems domain={current.domain} check={check} />
            </Alert>
          </div>
        ) : passed && current ? (
          <div className="px-4 py-2.5">
            <Alert
              tone="success"
              title={`${current.domain} reaches this server`}
            >
              The domain is added and Off. Turn it on when you are ready to
              serve profiles there.
            </Alert>
          </div>
        ) : null}
      </Frame>
    </form>
  )
}
