'use client'

import { Lock } from 'lucide-react'
import Link from 'next/link'
import { FC, ReactNode, useState } from 'react'

import { updateAdminDomainFeatures } from '@/lib/client'
import { ControlRow } from '@/lib/components/admin/settings/SettingsField'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Badge } from '@/lib/components/ui/badge'
import { Switch } from '@/lib/components/ui/switch'
import type { AdminDomainDetail } from '@/lib/services/domains/adminDomainTypes'
import {
  DOMAIN_FEATURES,
  type DomainFeature,
  type FeatureFlags
} from '@/lib/services/domains/domainFeatures'

const FEATURE_COPY: Record<
  DomainFeature,
  { label: string; description: string }
> = {
  fitness: {
    label: 'Fitness',
    description: 'Workouts, routes and the Fitness page.'
  },
  explore: {
    label: 'Explore',
    description: 'The Explore page with trending posts and people.'
  },
  messages: { label: 'Messages', description: 'Private conversations.' }
}

const sameFeatures = (a: DomainFeature[], b: DomainFeature[]) =>
  a.length === b.length && a.every((feature) => b.includes(feature))

interface Props {
  domain: AdminDomainDetail
  /** The server's own switches (Admin › Instance). */
  serverFeatures: FeatureFlags
  onSaved: (domain: AdminDomainDetail) => void
}

const InstanceLink: FC<{ children: ReactNode }> = ({ children }) => (
  <Link
    href="/admin/instance"
    className="text-primary-text font-medium underline"
  >
    {children}
  </Link>
)

/**
 * The domain page's Features box. A domain can turn off what the server has on,
 * never the reverse: a feature the server has off shows off and disabled with a
 * "Turned off on the server" chip. The primary domain follows the server's
 * switches, so its box only shows them.
 */
export const DomainFeaturesBox: FC<Props> = ({
  domain,
  serverFeatures,
  onSaved
}) => {
  const [disabled, setDisabled] = useState(domain.disabledFeatures)
  const [baseline, setBaseline] = useState(domain.disabledFeatures)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = domain.domain

  if (domain.source === 'primary') {
    return (
      <Frame
        footer={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-muted-foreground text-sm">
              The primary domain follows the server’s switches.
            </p>
            <Link
              href="/admin/instance"
              className="text-primary-text text-sm font-medium underline"
            >
              Edit on Instance
            </Link>
          </div>
        }
      >
        <ul className="space-y-3 p-4">
          {DOMAIN_FEATURES.map((feature) => (
            <li
              key={feature}
              className="flex items-center justify-between gap-4"
            >
              <div className="min-w-0 text-sm">
                <p className="font-medium">{FEATURE_COPY[feature].label}</p>
                <p className="text-muted-foreground">
                  {FEATURE_COPY[feature].description}
                </p>
              </div>
              <Badge tone={serverFeatures[feature] ? 'success' : 'gray'}>
                {serverFeatures[feature] ? 'On' : 'Off'}
              </Badge>
            </li>
          ))}
        </ul>
      </Frame>
    )
  }

  const dirty = !sameFeatures(disabled, baseline)

  const toggle = (feature: DomainFeature, on: boolean) => {
    setSaved(false)
    setDisabled((current) =>
      on
        ? current.filter((item) => item !== feature)
        : DOMAIN_FEATURES.filter(
            (item) => item === feature || current.includes(item)
          )
    )
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await updateAdminDomainFeatures(name, {
        disabledFeatures: disabled
      })
      setDisabled(next.disabledFeatures)
      setBaseline(next.disabledFeatures)
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
          actionLabel="Save features"
          idleNote={`Changes apply to ${name} only.`}
          dirty={dirty}
          saving={saving}
          saved={saved}
          error={error}
          onSave={() => void save()}
        />
      }
    >
      {DOMAIN_FEATURES.map((feature) => {
        const id = `domain-feature-${feature}`
        const serverOn = serverFeatures[feature]
        const { label, description } = FEATURE_COPY[feature]
        return (
          <ControlRow
            key={feature}
            htmlFor={id}
            label={
              serverOn ? (
                label
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  {label}
                  <Badge className="font-normal">
                    <Lock aria-hidden="true" className="size-3" />
                    Turned off on the server
                  </Badge>
                </span>
              )
            }
            description={
              serverOn ? (
                description
              ) : (
                <>
                  Turn it on in <InstanceLink>Instance</InstanceLink> first.
                </>
              )
            }
          >
            <Switch
              id={id}
              checked={serverOn && !disabled.includes(feature)}
              disabled={!serverOn || saving}
              onCheckedChange={(on) => toggle(feature, on)}
            />
          </ControlRow>
        )
      })}
      <p className="text-muted-foreground px-4 py-2.5 text-sm">
        A domain can turn off what the server has on, never the reverse.
      </p>
    </Frame>
  )
}
