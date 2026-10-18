'use client'

import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns/format'
import { Loader2, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import {
  AdminDomainRequestError,
  checkAdminDomain,
  removeAdminDomain,
  setAdminDomainStatus,
  updateAdminDomainRegistrations
} from '@/lib/client'
import { LinesTextarea } from '@/lib/components/admin/settings/LinesTextarea'
import {
  ControlRow,
  SettingsField
} from '@/lib/components/admin/settings/SettingsField'
import { BackLink } from '@/lib/components/back-link'
import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Switch } from '@/lib/components/ui/switch'
import { useHasHydrated } from '@/lib/hooks/useHasHydrated'
import type { AdminDomain } from '@/lib/services/domains/adminDomainTypes'

import { DomainCheckItems } from './DomainCheckItems'
import {
  getDomainCheckBadge,
  getDomainOnOffBadge,
  getDomainSourceNote
} from './domainLabels'

interface Props {
  domain: AdminDomain
  primaryDomain: string | null
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index])

type Registrations = Pick<
  AdminDomain,
  'signupsOpen' | 'allowedEmails' | 'allowExistingUsers'
>

const pickRegistrations = (domain: AdminDomain): Registrations => ({
  signupsOpen: domain.signupsOpen,
  allowedEmails: domain.allowedEmails,
  allowExistingUsers: domain.allowExistingUsers
})

const RegistrationsBox: FC<{
  domain: AdminDomain
  onSaved: (domain: AdminDomain) => void
}> = ({ domain, onSaved }) => {
  const [values, setValues] = useState(() => pickRegistrations(domain))
  const [baseline, setBaseline] = useState(() => pickRegistrations(domain))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEnv = domain.source === 'env'
  const name = domain.domain

  const dirty =
    values.signupsOpen !== baseline.signupsOpen ||
    values.allowExistingUsers !== baseline.allowExistingUsers ||
    !sameList(values.allowedEmails, baseline.allowedEmails)

  const update = (patch: Partial<Registrations>) => {
    setSaved(false)
    setValues((current) => ({ ...current, ...patch }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await updateAdminDomainRegistrations(name, {
        signupsOpen: values.signupsOpen,
        allowedEmails: values.allowedEmails,
        ...(isEnv ? null : { allowExistingUsers: values.allowExistingUsers })
      })
      setValues(pickRegistrations(next))
      setBaseline(pickRegistrations(next))
      setSaved(true)
      onSaved(next)
    } catch (caught) {
      setError(errorMessage(caught, 'Failed to save changes.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Frame
      form
      footer={
        <SaveBar
          dirty={dirty}
          saving={saving}
          saved={saved}
          error={error}
          onSave={() => void save()}
        />
      }
    >
      <ControlRow
        label="Sign-ups open"
        description={`People can create an account on ${name}.`}
        htmlFor="domain-signups-open"
      >
        <Switch
          id="domain-signups-open"
          checked={values.signupsOpen}
          onCheckedChange={(checked) => update({ signupsOpen: checked })}
        />
      </ControlRow>
      <SettingsField
        label="Allowed email addresses"
        htmlFor="domain-allowed-emails"
        help="One address per line. Leave empty to let anyone sign up."
      >
        <LinesTextarea
          id="domain-allowed-emails"
          value={values.allowedEmails}
          onChange={(next) => update({ allowedEmails: next })}
        />
      </SettingsField>
      <ControlRow
        label="Existing users can add profiles here"
        description={
          isEnv
            ? `Always on for a domain set in ACTIVITIES_TRUSTED_HOSTS.`
            : `People who already have an account can add a profile on ${name}.`
        }
        htmlFor="domain-allow-existing-users"
      >
        <Switch
          id="domain-allow-existing-users"
          checked={isEnv ? true : values.allowExistingUsers}
          disabled={isEnv}
          onCheckedChange={(checked) => update({ allowExistingUsers: checked })}
        />
      </ControlRow>
    </Frame>
  )
}

const StatusBox: FC<{
  domain: AdminDomain
  primaryDomain: string | null
  onChange: (domain: AdminDomain) => void
}> = ({ domain, primaryDomain, onChange }) => {
  const router = useRouter()
  const [busy, setBusy] = useState<'on' | 'off' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = domain.domain
  const primaryNote = primaryDomain
    ? `The primary domain, ${primaryDomain}, can’t be turned off.`
    : 'The primary domain can’t be turned off.'

  if (domain.source !== 'database') {
    return (
      <Frame>
        <p className="text-muted-foreground px-4 py-4 text-sm">
          {domain.source === 'primary'
            ? primaryNote
            : `${name} is set in ACTIVITIES_TRUSTED_HOSTS, so it is always on. Remove it from the env to turn it off.`}
        </p>
      </Frame>
    )
  }

  const setStatus = async (status: 'on' | 'off') => {
    setBusy(status)
    setError(null)
    try {
      onChange(await setAdminDomainStatus(name, status))
      router.refresh()
    } catch (caught) {
      if (caught instanceof AdminDomainRequestError && caught.domain) {
        onChange(caught.domain)
      }
      setError(errorMessage(caught, 'Failed to change the domain.'))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('remove')
    setError(null)
    try {
      await removeAdminDomain(name)
      router.push('/admin/domains')
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught, 'Failed to remove the domain.'))
      setBusy(null)
    }
  }

  const spinner = <Loader2 aria-hidden="true" className="animate-spin" />
  const isOn = domain.status === 'on'

  return (
    <Frame
      className="border-destructive/40 overflow-hidden"
      footer={<p className="text-muted-foreground text-sm">{primaryNote}</p>}
    >
      {isOn ? (
        <Alert
          title={`Turn off ${name}`}
          flush
          live={false}
          action={
            <Button
              variant="outline"
              size="sm"
              className="text-destructive-text"
              disabled={busy !== null}
              onClick={() => void setStatus('off')}
            >
              {busy === 'off' ? spinner : null}
              Turn off {name}
            </Button>
          }
        >
          This server stops answering as {name}: sign-in, sign-up and federation
          there stop. Profiles on it stay, and you can turn it back on at any
          time.
        </Alert>
      ) : (
        <Alert
          tone="info"
          title={`${name} is off`}
          flush
          live={false}
          action={
            <div className="flex flex-wrap gap-2">
              {domain.profiles === 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive-text"
                  disabled={busy !== null}
                  onClick={() => void remove()}
                >
                  {busy === 'remove' ? spinner : null}
                  Remove
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => void setStatus('on')}
              >
                {busy === 'on' ? spinner : null}
                Turn on {name}
              </Button>
            </div>
          }
        >
          {domain.profiles === 0
            ? 'Turning it on checks the domain again first. A domain with no profiles can be removed.'
            : 'Turning it on checks the domain again first. Its profiles stay while it is off.'}
        </Alert>
      )}
      {error ? (
        <p role="alert" className="text-destructive-text px-4 pb-4 text-sm">
          {error}
        </p>
      ) : null}
    </Frame>
  )
}

const CHECKED_AT_PATTERN = 'MMM d, yyyy, p'

const CheckBox: FC<{
  domain: AdminDomain
  onChange: (domain: AdminDomain) => void
}> = ({ domain, onChange }) => {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasHydrated = useHasHydrated()
  const check = domain.lastCheck

  const recheck = async () => {
    setChecking(true)
    setError(null)
    try {
      onChange(await checkAdminDomain(domain.domain))
    } catch (caught) {
      setError(errorMessage(caught, 'Failed to check the domain.'))
    } finally {
      setChecking(false)
    }
  }

  // The server cannot know the viewer's zone: UTC until hydration, then local.
  const checkedAt = domain.lastCheckedAt
  const checkedAtText =
    checkedAt === null
      ? null
      : format(
          hasHydrated ? new Date(checkedAt) : new UTCDate(checkedAt),
          CHECKED_AT_PATTERN
        )

  return (
    <Frame
      className="overflow-hidden"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground min-w-0 text-sm">
            {error ? (
              <span role="alert" className="text-destructive-text">
                {error}
              </span>
            ) : checkedAt !== null ? (
              <>
                Last checked{' '}
                <time dateTime={new Date(checkedAt).toISOString()}>
                  {checkedAtText}
                </time>
                .
              </>
            ) : (
              'Not checked yet.'
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={checking}
            onClick={() => void recheck()}
          >
            {checking ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            {checking ? 'Checking…' : 'Check again'}
          </Button>
        </div>
      }
    >
      {check ? (
        <Alert
          tone={check.passed ? 'success' : 'error'}
          flush
          live={false}
          title={
            check.passed
              ? `${domain.domain} reaches this server`
              : `${domain.domain} does not reach this server`
          }
        >
          <DomainCheckItems domain={domain.domain} check={check} />
        </Alert>
      ) : (
        <p className="text-muted-foreground px-4 py-4 text-sm">
          Check that {domain.domain} reaches this server before turning it on.
        </p>
      )}
    </Frame>
  )
}

/** Admin › Domains › one domain: the header, Registrations and the Turn off box. */
export const DomainSettings: FC<Props> = ({
  domain: initial,
  primaryDomain
}) => {
  const [domain, setDomain] = useState(initial)
  const checkBadge = getDomainCheckBadge(domain)
  const onOff = getDomainOnOffBadge(domain)
  const note = getDomainSourceNote(domain)
  const profiles = `${domain.profiles} profile${domain.profiles === 1 ? '' : 's'}`

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 max-md:flex-col max-md:gap-1">
        <BackLink
          href="/admin/domains"
          accessibleName="Back to domains"
          iconOnlyFrom="md"
          className="md:rounded-lg md:p-2 md:hover:bg-muted"
        />
        <PageHeader
          className="min-w-0 flex-1"
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-all">{domain.name || domain.domain}</span>
              {domain.source === 'primary' ? (
                <Badge tone="primary">Primary</Badge>
              ) : null}
              {checkBadge ? (
                <Badge tone={checkBadge.tone}>{checkBadge.label}</Badge>
              ) : null}
              <Badge tone={onOff.tone}>{onOff.label}</Badge>
            </span>
          }
          description={
            <span className="break-all">
              {domain.domain} · {profiles}
              {note ? <span className="block break-normal">{note}</span> : null}
            </span>
          }
        />
      </div>

      {domain.source === 'database' ? (
        <Section
          title="Check"
          description={`Whether ${domain.domain} reaches this server.`}
        >
          <CheckBox domain={domain} onChange={setDomain} />
        </Section>
      ) : null}

      <Section
        title="Registrations"
        description="Who can join or add a profile on this domain."
      >
        {domain.source === 'primary' ? (
          <Frame
            footer={
              <div className="flex justify-end">
                <Button variant="outline" size="sm" asChild>
                  <Link href="/admin/instance">Open Instance</Link>
                </Button>
              </div>
            }
          >
            <p className="text-muted-foreground px-4 py-4 text-sm">
              The primary domain’s sign-ups and allowed email addresses are the
              server’s, set in Instance.
            </p>
          </Frame>
        ) : (
          <RegistrationsBox domain={domain} onSaved={setDomain} />
        )}
      </Section>

      <Section
        title={
          domain.source === 'database' && domain.status === 'off'
            ? 'Turn on domain'
            : 'Turn off domain'
        }
      >
        <StatusBox
          domain={domain}
          primaryDomain={primaryDomain}
          onChange={setDomain}
        />
      </Section>
    </div>
  )
}
