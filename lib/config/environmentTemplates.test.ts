import { ENV_TEMPLATE_AREAS, EnvTemplateField } from './environmentTemplates'

const fieldsOf = (): { area: string; field: EnvTemplateField }[] =>
  ENV_TEMPLATE_AREAS.flatMap((area) =>
    area.kind === 'choice'
      ? area.choices.flatMap((choice) =>
          choice.fields.map((field) => ({ area: area.value, field }))
        )
      : area.fields.map((field) => ({ area: area.value, field }))
  )

describe('ENV_TEMPLATE_AREAS', () => {
  // A required field carries its placeholder into the generated block as the
  // value (EnvBlockBuilder falls back to it when nothing is typed), so a
  // placeholder an admin could paste and have *work* is a credential this
  // repository publishes. Every secret placeholder therefore has to be
  // obviously a stub, and never a command that reads like the builder already
  // ran it.
  const secretFields = fieldsOf().filter(({ field }) => field.secret)

  it('has at least one secret field to check', () => {
    expect(secretFields.length).toBeGreaterThan(0)
  })

  it.each(secretFields.map(({ area, field }) => ({ area, field })))(
    'keeps the $area secret placeholder $field.name an obvious stub',
    ({ field }) => {
      // Either a self-describing stub or a truncated real-format example.
      expect(field.placeholder).toMatch(/your-|…|EXAMPLE/)
    }
  )

  it.each(secretFields.map(({ area, field }) => ({ area, field })))(
    'keeps the $area secret placeholder $field.name from being a runnable command',
    ({ field }) => {
      expect(field.placeholder).not.toMatch(
        /\b(openssl|head|dd|uuidgen|pwgen|python3?|node)\b/
      )
    }
  )

  it('gives every field a unique variable name within its area', () => {
    for (const area of ENV_TEMPLATE_AREAS) {
      const groups =
        area.kind === 'choice'
          ? area.choices.map((choice) => choice.fields)
          : [area.fields]
      for (const group of groups) {
        const names = group.map((field) => field.name)
        expect(new Set(names).size).toBe(names.length)
      }
    }
  })
})
