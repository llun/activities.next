'use client'

import { FC, useState } from 'react'

import { updateAdminDomainHosting } from '@/lib/client'
import { LinesTextarea } from '@/lib/components/admin/settings/LinesTextarea'
import { SettingsField } from '@/lib/components/admin/settings/SettingsField'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { RadioCard } from '@/lib/components/surface/RadioCard'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Button } from '@/lib/components/ui/button'
import { RadioGroup } from '@/lib/components/ui/radio-group'
import type { AdminDomainDetail } from '@/lib/services/domains/adminDomainTypes'
import {
  BLUESKY_HOSTING_POLICIES,
  type BlueskyHostingPolicy
} from '@/lib/services/pds/hostingPolicyTypes'

const POLICY_COPY: Record<
  BlueskyHostingPolicy,
  { title: string; hint: string }
> = {
  nobody: {
    title: 'Nobody',
    hint: 'No one can host a Bluesky account on this domain.'
  },
  listed: {
    title: 'Listed accounts',
    hint: 'Only the email addresses and profiles listed below.'
  },
  everyone: {
    title: 'Everyone on this domain',
    hint: 'Any approved, confirmed profile on this domain.'
  }
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index])

type Draft = {
  policy: BlueskyHostingPolicy | null
  emails: string[]
  actors: string[]
}

const pickDraft = (domain: AdminDomainDetail): Draft => ({
  policy: domain.blueskyHostingPolicy,
  emails: domain.blueskyHostingAllowEmails ?? [],
  actors: domain.blueskyHostingAllowActors ?? []
})

interface Props {
  domain: AdminDomainDetail
  /** The domain's PDS hostname, from ACTIVITIES_BLUESKY_PDS. */
  pdsHostname: string
  onSaved: (domain: AdminDomainDetail) => void
}

/**
 * The domain page's Bluesky hosting box: who may host an account on this
 * domain. Shown only when the domain has an enabled PDS entry; the hostname,
 * relays and whether the PDS is on stay in ACTIVITIES_BLUESKY_PDS.
 */
export const DomainBlueskyHostingBox: FC<Props> = ({
  domain,
  pdsHostname,
  onSaved
}) => {
  const [draft, setDraft] = useState(() => pickDraft(domain))
  const [baseline, setBaseline] = useState(() => pickDraft(domain))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = domain.domain

  const dirty =
    draft.policy !== baseline.policy ||
    !sameList(draft.emails, baseline.emails) ||
    !sameList(draft.actors, baseline.actors)

  const update = (patch: Partial<Draft>) => {
    setSaved(false)
    setDraft((current) => ({ ...current, ...patch }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await updateAdminDomainHosting(name, {
        blueskyHostingPolicy: draft.policy,
        blueskyHostingAllowEmails: draft.emails,
        blueskyHostingAllowActors: draft.actors
      })
      setDraft(pickDraft(next))
      setBaseline(pickDraft(next))
      setSaved(true)
      onSaved(next)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Failed to save changes.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Frame
      form
      footer={
        <SaveBar
          actionLabel="Save hosting"
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
          onSave={() => void save()}
        />
      }
    >
      <FormRow
        label="Who can host"
        hint="Whether the domain's PDS is on, and its hostname, stay in ACTIVITIES_BLUESKY_PDS."
      >
        {({ labelledBy }) => (
          <div className="space-y-2">
            <RadioGroup
              aria-labelledby={labelledBy}
              value={draft.policy ?? ''}
              onValueChange={(value) =>
                update({ policy: value as BlueskyHostingPolicy })
              }
            >
              {BLUESKY_HOSTING_POLICIES.map((policy) => (
                <RadioCard
                  key={policy}
                  id={`domain-bluesky-hosting-${policy}`}
                  value={policy}
                  title={POLICY_COPY[policy].title}
                  hint={POLICY_COPY[policy].hint}
                />
              ))}
            </RadioGroup>
            {draft.policy === null ? (
              <p className="text-muted-foreground text-xs">
                Not set — using the server configuration.
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => update({ policy: null })}
              >
                Use the server configuration
              </Button>
            )}
          </div>
        )}
      </FormRow>
      {draft.policy === 'listed' ? (
        <>
          <SettingsField
            label="Email addresses"
            htmlFor="domain-bluesky-hosting-emails"
            help="One address per line. Leave empty to allow nobody by email."
          >
            <LinesTextarea
              id="domain-bluesky-hosting-emails"
              value={draft.emails}
              onChange={(emails) => update({ emails })}
            />
          </SettingsField>
          <SettingsField
            label="Profiles"
            htmlFor="domain-bluesky-hosting-actors"
            help="One profile per line, as username@domain. Leave empty to allow nobody by profile."
          >
            <LinesTextarea
              id="domain-bluesky-hosting-actors"
              value={draft.actors}
              onChange={(actors) => update({ actors })}
            />
          </SettingsField>
        </>
      ) : null}
      <p className="text-muted-foreground px-4 py-2.5 text-sm">
        This setting decides who may create an account; existing hosted accounts
        keep working when it changes. The bare domain handle stays admin-only.
        Handles of the form{' '}
        <span className="wrap-anywhere">name.{pdsHostname}</span> need a
        wildcard DNS record for{' '}
        <span className="wrap-anywhere">*.{pdsHostname}</span> and a certificate
        that covers it.
      </p>
    </Frame>
  )
}
