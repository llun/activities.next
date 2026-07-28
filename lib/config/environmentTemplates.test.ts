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

  it.each(fieldsOf())('gives $area/$field.name a placeholder', ({ field }) => {
    // The placeholder is the input's example. It is deliberately NOT what the
    // generated block carries — see the emptiness invariant in
    // EnvBlockBuilder.test.tsx, which is what keeps an unfilled block from
    // booting a real configuration.
    expect(field.placeholder.trim()).not.toBe('')
  })

  it('names every variable in the ACTIVITIES_ or AWS_ namespace', () => {
    for (const { field } of fieldsOf()) {
      expect(field.name).toMatch(/^(ACTIVITIES|AWS)_/)
    }
  })
})
