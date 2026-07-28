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

  // `defaultValue` is the one way a value reaches the generated block without
  // being typed, so it is also the one way a placeholder could be smuggled back
  // in — the leak invariant in EnvBlockBuilder.test.tsx skips a field whose
  // default IS its placeholder, which is correct for `./uploads` and would be a
  // silent hole for anything else. Pin the exact set, and the exact values.
  //
  // Adding `defaultValue: 'media.example.social'` to the bucket descriptor
  // would otherwise ship a copy-pasteable bucket the operator does not own,
  // with every other test still green.
  const DEFAULTS_BY_NAME: Record<string, string> = {
    ACTIVITIES_MEDIA_STORAGE_PATH: './uploads'
  }

  it('declares a default only where one is expected, with the expected value', () => {
    const withDefaults = fieldsOf().filter(({ field }) => field.defaultValue)

    expect(
      Object.fromEntries(
        withDefaults.map(({ field }) => [field.name, field.defaultValue])
      )
    ).toEqual(DEFAULTS_BY_NAME)
  })

  // The filesystem block is the one an operator can paste and run as-is, and
  // that only holds while its required variables carry real defaults. Without
  // one, `ACTIVITIES_MEDIA_STORAGE_PATH=` disables media and fitness storage
  // outright (both resolvers treat blank as unset — before that guard it
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
