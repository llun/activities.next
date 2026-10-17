import { parseProfileFieldsForm } from '@/lib/services/accounts/profileFields'

describe('parseProfileFieldsForm', () => {
  it('reports a form without profile links as absent', () => {
    expect(parseProfileFieldsForm({ name: 'Anna' })).toEqual({
      status: 'absent'
    })
  })

  it('reads the rows in index order and trims them', () => {
    expect(
      parseProfileFieldsForm({
        'fields[1][name]': ' Blog ',
        'fields[1][value]': ' https://blog.example ',
        'fields[0][name]': 'Pronouns',
        'fields[0][value]': 'they/them'
      })
    ).toEqual({
      status: 'ok',
      fields: [
        { name: 'Pronouns', value: 'they/them' },
        { name: 'Blog', value: 'https://blog.example' }
      ]
    })
  })

  it('drops a row with both parts empty', () => {
    expect(
      parseProfileFieldsForm({
        'fields[0][name]': '',
        'fields[0][value]': '  ',
        'fields[1][name]': 'Blog',
        'fields[1][value]': 'https://blog.example'
      })
    ).toEqual({
      status: 'ok',
      fields: [{ name: 'Blog', value: 'https://blog.example' }]
    })
  })

  it('saves an empty list when every row is cleared', () => {
    expect(
      parseProfileFieldsForm({
        'fields[0][name]': '',
        'fields[0][value]': ''
      })
    ).toEqual({ status: 'ok', fields: [] })
  })

  it.each([
    [
      'a label without content',
      { 'fields[0][name]': 'Blog', 'fields[0][value]': '' }
    ],
    [
      'content without a label',
      { 'fields[0][name]': '', 'fields[0][value]': 'x' }
    ],
    [
      'a label over 255 characters',
      { 'fields[0][name]': 'a'.repeat(256), 'fields[0][value]': 'x' }
    ],
    [
      'content over 2047 characters',
      { 'fields[0][name]': 'a', 'fields[0][value]': 'x'.repeat(2048) }
    ],
    [
      'a file instead of text',
      { 'fields[0][name]': new File([''], 'a.txt'), 'fields[0][value]': 'x' }
    ]
  ])('rejects %s', (_label, form) => {
    expect(parseProfileFieldsForm(form)).toEqual({ status: 'invalid' })
  })

  it('rejects a fifth row', () => {
    const form = Object.fromEntries(
      [0, 1, 2, 3, 4].flatMap((index) => [
        [`fields[${index}][name]`, `n${index}`],
        [`fields[${index}][value]`, `v${index}`]
      ])
    )
    expect(parseProfileFieldsForm(form)).toEqual({ status: 'invalid' })
  })
})
