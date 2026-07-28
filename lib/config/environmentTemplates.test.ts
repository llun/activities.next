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

  // The filesystem block is the one an operator can paste and run as-is, and
  // that only holds while its required variables carry real defaults. Without
  // one, `ACTIVITIES_MEDIA_STORAGE_PATH=` disables media storage outright
  // (getMediaStorageConfig treats blank as unset — before that guard it
  // resolved to the process CWD and served the application directory).
  it('keeps the filesystem storage block runnable with nothing typed', () => {
    const storage = ENV_TEMPLATE_AREAS.find((area) => area.value === 'storage')
    if (storage?.kind !== 'choice') throw new Error('storage area is missing')
    const fs = storage.choices.find((choice) => choice.value === 'fs')
    if (!fs) throw new Error('fs choice is missing')

    expect(fs.fields.length).toBeGreaterThan(0)
    for (const field of fs.fields.filter((candidate) => !candidate.optional)) {
      expect(field.defaultValue).toBeTruthy()
    }
  })

  it('names every variable in the ACTIVITIES_ or AWS_ namespace', () => {
    for (const { field } of fieldsOf()) {
      expect(field.name).toMatch(/^(ACTIVITIES|AWS)_/)
    }
  })
})
