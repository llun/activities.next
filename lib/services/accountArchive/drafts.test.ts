import { ARCHIVE_DRAFTS_MAX_BYTES } from './constants'
import { prepareArchiveDrafts } from './drafts'

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  composer: 'post-box',
  text: 'hello',
  ...overrides
})

describe('prepareArchiveDrafts', () => {
  it('writes the allowlisted fields of valid drafts', () => {
    const result = prepareArchiveDrafts([draft({ contentWarning: 'cw' })], {
      now: () => Date.UTC(2026, 0, 1)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = JSON.parse(result.json)
    expect(parsed).toMatchObject({
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      drafts: [
        { id: 'd1', text: 'hello', contentWarning: 'cw', attachments: [] }
      ]
    })
    expect(result.count).toBe(1)
  })

  it('drops queue state, idempotency keys, account ids and blob bytes', () => {
    const result = prepareArchiveDrafts([
      draft({
        accountId: 'acct',
        submit: { key: 'secret-key', fingerprint: 'f' },
        queue: { state: 'waiting', claim: { tabId: 't', until: 1 } },
        lockedMessage: 'x',
        attachments: [
          {
            localId: 'a',
            mediaType: 'image',
            fileName: 'a.png',
            description: '',
            hasBlob: true,
            bytes: [1, 2, 3]
          }
        ]
      })
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const word of [
      'accountId',
      'secret-key',
      'queue',
      'claim',
      'hasBlob'
    ]) {
      expect(result.json).not.toContain(word)
    }
    expect(result.json).not.toContain('"bytes"')
  })

  it.each([
    ['an object instead of a list', { drafts: [] }],
    ['a draft without a composer', [{ id: 'x', text: 'a' }]],
    ['a draft of the wrong shape', [draft({ text: 12 })]],
    ['a string', 'drafts'],
    [
      'a poll with a bad type',
      [draft({ poll: { choices: [], pollType: 'x' } })]
    ]
  ])('rejects %s', (_name, input) => {
    expect(prepareArchiveDrafts(input)).toEqual({
      ok: false,
      reason: 'invalid'
    })
  })

  it('rejects a payload over the 5 MiB cap before looking at it', () => {
    const big = [draft({ text: 'x'.repeat(ARCHIVE_DRAFTS_MAX_BYTES) })]
    expect(prepareArchiveDrafts(big)).toEqual({
      ok: false,
      reason: 'too-large'
    })
  })

  it('accepts an empty list', () => {
    const result = prepareArchiveDrafts([])
    expect(result).toMatchObject({ ok: true, count: 0 })
  })
})
