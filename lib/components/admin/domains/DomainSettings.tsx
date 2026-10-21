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
  updateAdminDomainIdentity,
  updateAdminDomainPolicies,
  updateAdminDomainRegistrations
} from '@/lib/client'
import { LinesTextarea } from '@/lib/components/admin/settings/LinesTextarea'
import { PolicyDate } from '@/lib/components/admin/settings/PolicyDate'
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
import { Input } from '@/lib/components/ui/input'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'
import { useHasHydrated } from '@/lib/hooks/useHasHydrated'
import type { AdminAnnouncement } from '@/lib/services/announcements/adminAnnouncement'
import {
  ADMIN_DOMAIN_FIELD_LIMITS,
  type AdminDomain,
  type AdminDomainDetail,
  type ServerIdentityView
} from '@/lib/services/domains/adminDomainTypes'
import type { FeatureFlags } from '@/lib/services/domains/domainFeatures'
import type { AdminRule } from '@/lib/services/rules/adminRule'
import { cn } from '@/lib/utils'

import { DomainAnnouncementsBox } from './DomainAnnouncementsBox'
import { DomainCheckItems } from './DomainCheckItems'
import { DomainFeaturesBox } from './DomainFeaturesBox'
import { DomainReportsBox } from './DomainReportsBox'
import { DomainRulesBox } from './DomainRulesBox'
import {
  getDomainCheckBadge,
  getDomainOnOffBadge,
  getDomainSourceNote
} from './domainLabels'

/** What the page shows beyond the domain's own settings (step 5), read on the server. */
export interface DomainPageScope {
  /** The server rules (every domain). */
  serverRules: AdminRule[]
  /** The domain's own rules; empty on the primary, which has none. */
  ownRules: AdminRule[]
  /** The published and scheduled announcements on this domain only, newest first. */
  announcements: AdminAnnouncement[]
  /** Published announcements for every domain showing now, which also show here. */
  allDomainsAnnouncements: number
  /** The server's own feature switches (Admin › Instance). */
  serverFeatures: FeatureFlags
  /** Open reports about profiles on this domain. */
  openReports: number
  /** The count hit the query's cap, so it reads "1000+". */
  openReportsCapped?: boolean
  /** The server's wall clock, epoch ms, for the announcement badges. */
  currentTime: number
}

interface Props {
  domain: AdminDomainDetail
  primaryDomain: string | null
  server: ServerIdentityView
  scope: DomainPageScope
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
  onSaved: (domain: AdminDomainDetail) => void
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
        description={
          <>
            People can create an account on{' '}
            <span className="wrap-anywhere">{name}</span>.
          </>
        }
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
          isEnv ? (
            <>
              On for people who signed up on the primary or on{' '}
              <span className="wrap-anywhere">{name}</span>. Someone who joined
              through another domain can add a profile here only while this
              domain's sign-ups would admit them, or if they already have one
              here.
            </>
          ) : (
            <>
              People who already have an account can add a profile on{' '}
              <span className="wrap-anywhere">{name}</span>.
            </>
          )
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
  onChange: (domain: AdminDomainDetail) => void
}> = ({ domain, primaryDomain, onChange }) => {
  const router = useRouter()
  const [busy, setBusy] = useState<'on' | 'off' | 'remove' | null>(null)
  const [error, setError] = useState<{
    title: string
    action: 'on' | 'off' | 'remove'
  } | null>(null)
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
      setError({
        title: errorMessage(caught, 'Failed to change the domain.'),
        action: status
      })
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
      setError({
        title: errorMessage(caught, 'Failed to remove the domain.'),
        action: 'remove'
      })
      setBusy(null)
    }
  }

  const spinner = <Loader2 aria-hidden="true" className="animate-spin" />
  const isOn = domain.status === 'on'

  return (
    <>
      {isOn ? (
        <Alert
          title={`Turn off ${name}`}
          live={false}
          action={
            <Button
              variant="outline"
              size="sm"
              className="text-destructive-text h-auto min-h-8 py-1.5 max-w-full text-left whitespace-normal"
              disabled={busy !== null}
              onClick={() => void setStatus('off')}
            >
              {busy === 'off' ? spinner : null}
              <span className="wrap-anywhere">Turn off {name}</span>
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
          live={false}
          action={
            <div className="flex flex-wrap gap-2">
              {domain.profiles === 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive-text h-auto min-h-8 py-1.5 max-w-full"
                  disabled={busy !== null}
                  onClick={() => void remove()}
                >
                  {busy === 'remove' ? spinner : null}
                  Remove
                </Button>
              ) : null}
              <Button
                size="sm"
                className="h-auto min-h-8 py-1.5 max-w-full text-left whitespace-normal"
                disabled={busy !== null}
                onClick={() => void setStatus('on')}
              >
                {busy === 'on' ? spinner : null}
                <span className="wrap-anywhere">Turn on {name}</span>
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
        <Alert
          title={error.title}
          onRetry={() =>
            void (error.action === 'remove'
              ? remove()
              : setStatus(error.action))
          }
        />
      ) : null}
      <p className="text-muted-foreground text-sm">{primaryNote}</p>
    </>
  )
}

const CHECKED_AT_PATTERN = 'MMM d, yyyy, p'

const CheckBox: FC<{
  domain: AdminDomain
  onChange: (domain: AdminDomainDetail) => void
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

  const bar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground min-w-0 text-sm">
        {checkedAt !== null ? (
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
  )

  return (
    <>
      {check ? (
        <Alert
          tone={check.passed ? 'success' : 'error'}
          live={false}
          title={
            check.passed
              ? `${domain.domain} reaches this server`
              : `${domain.domain} does not reach this server`
          }
        >
          <DomainCheckItems domain={domain.domain} check={check} />
        </Alert>
      ) : null}
      {error ? <Alert title={error} onRetry={() => void recheck()} /> : null}
      {/* One tree for both states, so the first check keeps the button (and its focus). */}
      <Frame>
        {check ? null : (
          <p className="text-muted-foreground px-4 py-4 text-sm">
            Check that <span className="wrap-anywhere">{domain.domain}</span>{' '}
            reaches this server before turning it on.
          </p>
        )}
        <div className={cn('px-4 py-3', !check && 'border-t')}>{bar}</div>
      </Frame>
    </>
  )
}

const SAME_AS_SERVER = 'Same as server'
const OVERRIDE_REQUIRED = 'Enter a value or use Same as server'

// One field the domain can set or leave as "Same as server". The draft text is
// kept while the switch is on, so toggling never loses what was typed.
type Override = { same: boolean; text: string }

const toOverride = (value: string | null): Override => ({
  same: value === null,
  text: value ?? ''
})

// What is sent and compared: null for "Same as server", else trimmed text.
const overrideValue = (field: Override): string | null =>
  field.same ? null : field.text.trim()

const SameAsServerSwitch: FC<{
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}> = ({ id, label, checked, disabled, onChange }) => (
  <label
    htmlFor={id}
    className="text-muted-foreground mt-2 flex w-fit items-center gap-2 text-xs"
  >
    <Switch
      id={id}
      aria-label={`${label}: ${SAME_AS_SERVER}`}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
    {SAME_AS_SERVER}
  </label>
)

type IdentityKey = 'name' | 'description' | 'contactEmail'
type IdentityDrafts = Record<IdentityKey, Override>

const IDENTITY_FIELDS: {
  key: IdentityKey
  label: string
  multiline?: boolean
  type?: 'email'
}[] = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description', multiline: true },
  { key: 'contactEmail', label: 'Contact email', type: 'email' }
]

const pickIdentity = (domain: AdminDomainDetail): IdentityDrafts => ({
  name: toOverride(domain.name),
  description: toOverride(domain.description),
  contactEmail: toOverride(domain.contactEmail)
})

const IdentityBox: FC<{
  domain: AdminDomainDetail
  server: ServerIdentityView
  readOnly: boolean
  onSaved: (domain: AdminDomainDetail) => void
}> = ({ domain, server, readOnly, onSaved }) => {
  const [drafts, setDrafts] = useState(() => pickIdentity(domain))
  const [baseline, setBaseline] = useState(() => pickIdentity(domain))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = domain.domain

  const dirty = IDENTITY_FIELDS.some(
    ({ key }) => overrideValue(drafts[key]) !== overrideValue(baseline[key])
  )
  const missing = IDENTITY_FIELDS.some(
    ({ key }) => !drafts[key].same && drafts[key].text.trim() === ''
  )

  const update = (key: IdentityKey, patch: Partial<Override>) => {
    setSaved(false)
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch }
    }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await updateAdminDomainIdentity(name, {
        name: overrideValue(drafts.name),
        description: overrideValue(drafts.description),
        contactEmail: overrideValue(drafts.contactEmail)
      })
      setDrafts(pickIdentity(next))
      setBaseline(pickIdentity(next))
      setSaved(true)
      onSaved(next)
    } catch (caught) {
      setError(errorMessage(caught, 'Failed to save changes.'))
    } finally {
      setSaving(false)
    }
  }

  const serverValue: Record<IdentityKey, string> = {
    name: server.name,
    description: server.description,
    contactEmail: server.contactEmail
  }

  return (
    <Frame
      form
      footer={
        readOnly ? undefined : (
          <SaveBar
            actionLabel="Save identity"
            idleNote={
              <>
                Changes apply to <span className="wrap-anywhere">{name}</span>{' '}
                only.
              </>
            }
            dirty={dirty}
            saving={saving}
            saved={saved}
            error={error}
            disabledReason={missing ? OVERRIDE_REQUIRED : undefined}
            onSave={() => void save()}
          />
        )
      }
    >
      {IDENTITY_FIELDS.map(({ key, label, multiline, type }) => {
        const id = `domain-${key}`
        const draft = drafts[key]
        const useServer = readOnly || draft.same
        const shared = {
          id,
          disabled: useServer,
          maxLength: ADMIN_DOMAIN_FIELD_LIMITS[key],
          value: useServer ? serverValue[key] : draft.text,
          onChange: (
            event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>
          ) => update(key, { text: event.target.value })
        }
        return (
          <SettingsField
            key={key}
            label={label}
            htmlFor={id}
            className="sm:items-start"
          >
            <div>
              {multiline ? (
                <Textarea rows={3} {...shared} />
              ) : (
                <Input type={type} {...shared} />
              )}
              {readOnly ? null : (
                <SameAsServerSwitch
                  id={`${id}-same`}
                  label={label}
                  checked={draft.same}
                  onChange={(same) => update(key, { same })}
                />
              )}
            </div>
          </SettingsField>
        )
      })}
      <SettingsField label="Contact account" className="sm:items-start">
        <div className="text-sm">
          <p>
            {server.contactAccount ? (
              <>
                {server.contactAccount}
                <span className="text-muted-foreground">
                  {' '}
                  · the server’s first admin
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </p>
          <p className="text-muted-foreground mt-1">Same for every domain.</p>
        </div>
      </SettingsField>
    </Frame>
  )
}

type PolicyKey = 'termsOfService' | 'privacyPolicy'
type PolicyDrafts = Record<PolicyKey, Override>

const POLICY_FIELDS: {
  key: PolicyKey
  label: string
  short: string
  serverKey: 'terms' | 'privacy'
  updatedKey: 'termsOfServiceUpdatedAt' | 'privacyPolicyUpdatedAt'
}[] = [
  {
    key: 'termsOfService',
    label: 'Terms of service',
    short: 'terms of service',
    serverKey: 'terms',
    updatedKey: 'termsOfServiceUpdatedAt'
  },
  {
    key: 'privacyPolicy',
    label: 'Privacy policy',
    short: 'privacy policy',
    serverKey: 'privacy',
    updatedKey: 'privacyPolicyUpdatedAt'
  }
]

const pickPolicies = (domain: AdminDomainDetail): PolicyDrafts => ({
  termsOfService: toOverride(domain.termsOfService),
  privacyPolicy: toOverride(domain.privacyPolicy)
})

// The muted stand-in for the server's policy: whether it is set and when it
// last changed. The server's text is never sent to this page.
const ServerPolicyNote: FC<{
  short: string
  state: ServerIdentityView['terms']
}> = ({ short, state }) => (
  <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">
    {state.set ? (
      <>
        Using the server {short}.
        {state.updatedAt !== null ? (
          <>
            {' '}
            Last updated <PolicyDate at={state.updatedAt} />.
          </>
        ) : null}
      </>
    ) : (
      <>The server has no {short}.</>
    )}{' '}
    <Link
      href="/admin/instance"
      className="text-primary-text font-medium underline"
    >
      Edit on Instance
    </Link>
  </p>
)

const PoliciesBox: FC<{
  domain: AdminDomainDetail
  server: ServerIdentityView
  readOnly: boolean
  onSaved: (domain: AdminDomainDetail) => void
}> = ({ domain, server, readOnly, onSaved }) => {
  const [drafts, setDrafts] = useState(() => pickPolicies(domain))
  const [baseline, setBaseline] = useState(() => pickPolicies(domain))
  const [updatedAt, setUpdatedAt] = useState({
    termsOfService: domain.termsOfServiceUpdatedAt,
    privacyPolicy: domain.privacyPolicyUpdatedAt
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = domain.domain

  const dirty = POLICY_FIELDS.some(
    ({ key }) => overrideValue(drafts[key]) !== overrideValue(baseline[key])
  )
  const missing = POLICY_FIELDS.some(
    ({ key }) => !drafts[key].same && drafts[key].text.trim() === ''
  )

  const update = (key: PolicyKey, patch: Partial<Override>) => {
    setSaved(false)
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch }
    }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await updateAdminDomainPolicies(name, {
        termsOfService: overrideValue(drafts.termsOfService),
        privacyPolicy: overrideValue(drafts.privacyPolicy)
      })
      setDrafts(pickPolicies(next))
      setBaseline(pickPolicies(next))
      setUpdatedAt({
        termsOfService: next.termsOfServiceUpdatedAt,
        privacyPolicy: next.privacyPolicyUpdatedAt
      })
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
        readOnly ? undefined : (
          <SaveBar
            actionLabel="Save policies"
            idleNote={
              <>
                Changes apply to <span className="wrap-anywhere">{name}</span>{' '}
                only.
              </>
            }
            dirty={dirty}
            saving={saving}
            saved={saved}
            error={error}
            disabledReason={missing ? OVERRIDE_REQUIRED : undefined}
            onSave={() => void save()}
          />
        )
      }
    >
      {POLICY_FIELDS.map((field) => {
        const id = `domain-${field.key}`
        const helpId = `${id}-help`
        const draft = drafts[field.key]
        const useServer = readOnly || draft.same
        const at = updatedAt[field.key]
        return (
          <SettingsField
            key={field.key}
            label={field.label}
            htmlFor={useServer ? undefined : id}
            className="sm:items-start"
          >
            <div>
              {useServer ? (
                <ServerPolicyNote
                  short={field.short}
                  state={server[field.serverKey]}
                />
              ) : (
                <>
                  <Textarea
                    id={id}
                    rows={16}
                    className="font-mono"
                    aria-describedby={helpId}
                    maxLength={ADMIN_DOMAIN_FIELD_LIMITS[field.key]}
                    value={draft.text}
                    onChange={(event) =>
                      update(field.key, { text: event.target.value })
                    }
                  />
                  <p
                    id={helpId}
                    className="text-muted-foreground mt-1.5 text-xs"
                  >
                    Markdown.
                    {at !== null ? (
                      <>
                        {' '}
                        Last updated <PolicyDate at={at} />.
                      </>
                    ) : null}
                  </p>
                </>
              )}
              {readOnly ? null : (
                <SameAsServerSwitch
                  id={`${id}-same`}
                  label={field.label}
                  checked={draft.same}
                  onChange={(same) => update(field.key, { same })}
                />
              )}
            </div>
          </SettingsField>
        )
      })}
    </Frame>
  )
}

/**
 * Admin › Domains › one domain: the header, Registrations, Identity, Terms and
 * privacy, Rules, Announcements, Features, Reports and the Turn off box.
 */
export const DomainSettings: FC<Props> = ({
  domain: initial,
  primaryDomain,
  server,
  scope
}) => {
  const [domain, setDomain] = useState(initial)
  const checkBadge = getDomainCheckBadge(domain)
  const onOff = getDomainOnOffBadge(domain)
  const note = getDomainSourceNote(domain)
  const isPrimary = domain.source === 'primary'
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

      {isPrimary ? (
        <Alert
          tone="info"
          title="The primary domain uses the server’s identity, terms and privacy, rules and features."
          live={false}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/instance">Open Instance</Link>
            </Button>
          }
        >
          Edit them on Admin › Instance, and the rules on Admin › Server rules.
        </Alert>
      ) : null}

      {domain.source === 'database' ? (
        <Section
          title="Check"
          description={
            <>
              Whether <span className="wrap-anywhere">{domain.domain}</span>{' '}
              reaches this server.
            </>
          }
        >
          <CheckBox domain={domain} onChange={setDomain} />
        </Section>
      ) : null}

      <Section
        title="Registrations"
        description="Who can join or add a profile on this domain."
      >
        {isPrimary ? (
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
        title="Identity"
        description={
          <>
            What visitors to{' '}
            <span className="wrap-anywhere">{domain.domain}</span> see as the
            name of this server.
          </>
        }
      >
        <IdentityBox
          key={`identity-${domain.domain}`}
          domain={domain}
          server={server}
          readOnly={isPrimary}
          onSaved={setDomain}
        />
      </Section>

      <Section
        title="Terms and privacy"
        description={
          <>
            Shown on <span className="wrap-anywhere">{domain.domain}</span>
            /terms-of-service and{' '}
            <span className="wrap-anywhere">{domain.domain}</span>
            /privacy-policy and linked from sign-up.
          </>
        }
      >
        <PoliciesBox
          key={`policies-${domain.domain}`}
          domain={domain}
          server={server}
          readOnly={isPrimary}
          onSaved={setDomain}
        />
      </Section>

      <Section
        title="Rules"
        description={
          isPrimary ? (
            <>
              What people see on the about page and in the rules API on{' '}
              <span className="wrap-anywhere">{domain.domain}</span>.
            </>
          ) : (
            <>
              What people see on the about page and in the rules API on{' '}
              <span className="wrap-anywhere">{domain.domain}</span>: the server
              rules first, then the rules of this domain.
            </>
          )
        }
      >
        <DomainRulesBox
          key={`rules-${domain.domain}`}
          domain={domain.domain}
          serverRules={scope.serverRules}
          ownRules={scope.ownRules}
          readOnly={isPrimary}
        />
      </Section>

      <Section
        title="Announcements"
        description={
          <>
            Notices people see in the announcement panel on{' '}
            <span className="wrap-anywhere">{domain.domain}</span>.
          </>
        }
      >
        <DomainAnnouncementsBox
          domain={domain.domain}
          announcements={scope.announcements}
          allDomainsCount={scope.allDomainsAnnouncements}
          currentTime={scope.currentTime}
        />
      </Section>

      <Section
        title="Features"
        description={
          isPrimary ? (
            <>
              What shows in the navigation on{' '}
              <span className="wrap-anywhere">{domain.domain}</span>.
            </>
          ) : (
            <>
              What shows in the navigation on{' '}
              <span className="wrap-anywhere">{domain.domain}</span>. Pages stay
              reachable by link; only the navigation entry is hidden.
            </>
          )
        }
      >
        <DomainFeaturesBox
          key={`features-${domain.domain}`}
          domain={domain}
          serverFeatures={scope.serverFeatures}
          onSaved={setDomain}
        />
      </Section>

      <Section
        title="Reports"
        description={
          <>
            Reports about profiles on{' '}
            <span className="wrap-anywhere">{domain.domain}</span>. They stay in
            one queue for the whole server.
          </>
        }
      >
        <DomainReportsBox
          domain={domain.domain}
          openReports={scope.openReports}
          capped={scope.openReportsCapped}
        />
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
