'use client'

import { Lock } from 'lucide-react'
import { FC, ReactNode, useMemo, useState } from 'react'

import { Input } from '@/lib/components/ui/input'
import { Select } from '@/lib/components/ui/select'
import {
  ENV_TEMPLATE_AREAS,
  type EnvTemplateArea,
  type EnvTemplateField
} from '@/lib/config/environmentTemplates'
import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'

import { SettingsField } from './SettingsField'
import { SettingsSection } from './SettingsSection'

// "Configure environment": a builder for the infrastructure this server reads
// from the environment at boot and never from the database — media storage and
// the fitness map provider. It assembles a copy-pasteable `.env` block so an
// admin does not have to look the variable names up, and it is deliberately
// inert: nothing typed here is submitted, saved, or sent anywhere.

// A fixed-width mask, so the preview never gives away how long a secret is.
const MASK = '•'.repeat(12)

interface EnvBlockLine {
  name: string
  // The real value, so a copy carries it even when the preview masks it.
  value: string
  masked?: boolean
}

const EnvVarName: FC<{ name: string }> = ({ name }) => (
  <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">
    {name}
  </code>
)

// Amber callout matching the env-lock badge: this section looks like the saved
// settings above it, so it has to say plainly that Update does not reach it.
const EnvNotice: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="flex items-start gap-2.5 rounded-lg bg-amber-100 px-3.5 py-2.5 text-[13px] leading-5 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
    <span>{children}</span>
  </div>
)

interface EnvFieldsProps {
  fields: EnvTemplateField[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
}

const EnvFields: FC<EnvFieldsProps> = ({ fields, values, onChange }) => (
  <div className="grid gap-4 sm:grid-cols-2">
    {fields.map((field) => (
      <div
        key={field.name}
        className={field.wide ? 'sm:col-span-2' : undefined}
      >
        <SettingsField
          label={field.label}
          htmlFor={`env-${field.name}`}
          help={<EnvVarName name={field.name} />}
        >
          <Input
            id={`env-${field.name}`}
            type={field.secret ? 'password' : 'text'}
            value={values[field.name] ?? ''}
            placeholder={field.placeholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange(field.name, event.target.value)}
            className="font-mono text-[13px]"
          />
        </SettingsField>
      </div>
    ))}
  </div>
)

// The generated block. Fixed dark surface in both themes: it is a terminal
// excerpt, not page chrome. In dark mode it steps below the card and keeps a
// hairline ring, which is how the surface ramp separates it there — plain
// neutral-900 is the card colour and would read as no block at all.
const EnvBlockPreview: FC<{ lines: EnvBlockLine[] }> = ({ lines }) => {
  const { copied, copy } = useCopyToClipboard(2000)
  const block = lines.map(({ name, value }) => `${name}=${value}`).join('\n')

  return (
    <div className="rounded-xl bg-neutral-900 p-4 ring-1 ring-white/10 dark:bg-neutral-950">
      {/* The button sits in normal flow above the block, not overlaid on it.
          The design mock overlays it at the top right, but that only works at
          desktop width: a `pre`'s inline scroll extent is max(clientWidth,
          longest line) — end-side padding is inside the client box and is never
          appended after overflowing content — so an overlaid button covers the
          tail of line 1 with no way to scroll it clear whenever line 1 is the
          longest line, which is every single-line block. Keep it in flow. */}
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => copy(block)}
          className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            copied
              ? 'border-green-400 text-green-300'
              : 'border-white/20 text-white/75 hover:bg-white/10'
          }`}
        >
          {copied ? 'Copied' : 'Copy .env block'}
        </button>
      </div>
      <pre className="overflow-x-auto font-mono text-[12.5px] leading-6 text-neutral-200">
        {lines.map(({ name, value, masked }) => (
          <div key={name}>
            <span className="text-orange-400">{name}</span>
            <span className="text-neutral-500">=</span>
            {masked ? MASK : value}
          </div>
        ))}
      </pre>
      <p className="mt-2 text-[11px] text-neutral-400">
        Secrets are masked above but included when you copy.
      </p>
    </div>
  )
}

// One area's builder: the backend/provider picker, its fields, and the block
// they produce. Each area owns its own state so switching areas never discards
// what the admin has already typed.
const EnvAreaBuilder: FC<{ area: EnvTemplateArea }> = ({ area }) => {
  const [choiceValue, setChoiceValue] = useState(area.defaultChoice)
  const [values, setValues] = useState<Record<string, string>>({})

  const choice =
    area.choices.find((candidate) => candidate.value === choiceValue) ??
    area.choices[0]

  const lines = useMemo<EnvBlockLine[]>(() => {
    const selector: EnvBlockLine = {
      name: area.selectorName,
      value: choice.value
    }
    const fieldLines = choice.fields.flatMap<EnvBlockLine>((field) => {
      const value = (values[field.name] ?? '').trim()
      // An optional variable only belongs in the block once it has a value; a
      // required one carries its placeholder as a visible to-do.
      if (field.optional && !value) return []
      return [
        {
          name: field.name,
          value: value || field.placeholder,
          masked: Boolean(field.secret && value)
        }
      ]
    })
    return [selector, ...fieldLines]
  }, [area.selectorName, choice, values])

  const setFieldValue = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }))

  return (
    <>
      <SettingsField
        label={area.selectorLabel}
        htmlFor={`env-${area.value}-choice`}
        help={
          <>
            Sets <EnvVarName name={area.selectorName} />.
            {choice.note ? ` ${choice.note}` : ''}
          </>
        }
      >
        <Select
          id={`env-${area.value}-choice`}
          value={choice.value}
          onChange={(event) => setChoiceValue(event.target.value)}
        >
          {area.choices.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>
              {candidate.label}
            </option>
          ))}
        </Select>
      </SettingsField>

      {choice.fields.length > 0 && (
        <EnvFields
          fields={choice.fields}
          values={values}
          onChange={setFieldValue}
        />
      )}

      <EnvBlockPreview lines={lines} />
    </>
  )
}

export const EnvBlockBuilder: FC = () => {
  const [areaValue, setAreaValue] = useState(ENV_TEMPLATE_AREAS[0].value)
  const area =
    ENV_TEMPLATE_AREAS.find((candidate) => candidate.value === areaValue) ??
    ENV_TEMPLATE_AREAS[0]

  return (
    <SettingsSection
      title="Configure environment"
      description="Infrastructure is configured in .env, not the database: pick an area, fill in the values, paste the block into your .env, then restart. Nothing typed here is sent or stored anywhere."
    >
      <EnvNotice>
        The <strong>Update</strong> button above does not save any of this — the
        server reads {area.subject} from the environment at boot, never from the
        database.
      </EnvNotice>

      <SettingsField
        label="Environment area"
        htmlFor="env-area"
        help={area.blurb}
      >
        <Select
          id="env-area"
          value={area.value}
          onChange={(event) => setAreaValue(event.target.value)}
        >
          {ENV_TEMPLATE_AREAS.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>
              {candidate.label}
            </option>
          ))}
        </Select>
      </SettingsField>

      <div className="h-px bg-border" />

      {/* Every area stays mounted so its half-typed values survive a switch;
          the inactive ones use the `hidden` attribute, which takes them out of
          the tab order and the accessibility tree. */}
      {ENV_TEMPLATE_AREAS.map((candidate) => (
        <div
          key={candidate.value}
          role="group"
          aria-label={candidate.label}
          hidden={candidate.value !== area.value}
          className="space-y-6"
        >
          <EnvAreaBuilder area={candidate} />
        </div>
      ))}
    </SettingsSection>
  )
}
