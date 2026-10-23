import type { SavedProfile } from '@/lib/types/domain/savedProfile'

import {
  buildProfilePatch,
  describeChanges,
  getChangedKeys,
  getErrorField,
  getPendingLinkValues,
  isDraftDirty,
  normalizeFields,
  toDraft
} from './profileDraft'

const SAVED: SavedProfile = {
  name: 'Anna',
  summary: 'Bio',
  fields: [
    {
      name: 'Website',
      value: 'https://anna.example',
      verifiedAt: '2026-10-01T00:00:00.000Z'
    }
  ],
  iconUrl: 'https://llun.test/api/v1/files/a.jpg',
  headerImageUrl: null,
  avatarDescription: '',
  headerDescription: '',
  showReplies: true,
  showMedia: true,
  showGallery: true,
  showFitness: true
}

describe('toDraft', () => {
  it('drops the link check time', () => {
    expect(toDraft(SAVED).fields).toEqual([
      { name: 'Website', value: 'https://anna.example' }
    ])
  })
})

describe('normalizeFields', () => {
  it('trims rows and drops the ones that are empty in both parts', () => {
    expect(
      normalizeFields([
        { name: ' Site ', value: ' https://a.example ' },
        { name: '  ', value: '' },
        { name: 'Half', value: '' }
      ])
    ).toEqual([
      { name: 'Site', value: 'https://a.example' },
      { name: 'Half', value: '' }
    ])
  })
})

describe('getChangedKeys', () => {
  it('is empty for an untouched draft', () => {
    expect(getChangedKeys(toDraft(SAVED), SAVED)).toEqual([])
    expect(isDraftDirty(toDraft(SAVED), SAVED)).toBe(false)
  })

  it('names each key that differs', () => {
    const draft = {
      ...toDraft(SAVED),
      name: 'Anna K',
      iconUrl: null,
      showFitness: false
    }
    expect(getChangedKeys(draft, SAVED)).toEqual([
      'name',
      'iconUrl',
      'showFitness'
    ])
  })

  it('ignores whitespace-only differences and empty rows in the links', () => {
    const draft = toDraft(SAVED)
    draft.fields = [
      { name: ' Website', value: 'https://anna.example ' },
      { name: '', value: '' }
    ]
    expect(getChangedKeys(draft, SAVED)).toEqual([])
  })

  it('sees a changed, moved or removed link', () => {
    const base = toDraft(SAVED)
    expect(
      getChangedKeys(
        { ...base, fields: [{ name: 'Website', value: 'https://b.example' }] },
        SAVED
      )
    ).toEqual(['fields'])
    expect(getChangedKeys({ ...base, fields: [] }, SAVED)).toEqual(['fields'])
  })
})

describe('buildProfilePatch', () => {
  it('holds only the changed keys', () => {
    const draft = { ...toDraft(SAVED), summary: 'New', showMedia: false }
    expect(buildProfilePatch(draft, SAVED)).toEqual({
      summary: 'New',
      showMedia: false
    })
  })

  it('is empty when nothing changed', () => {
    expect(buildProfilePatch(toDraft(SAVED), SAVED)).toEqual({})
  })

  it('sends a cleared image as null and an emptied name as an empty string', () => {
    const draft = { ...toDraft(SAVED), iconUrl: null, name: '' }
    expect(buildProfilePatch(draft, SAVED)).toEqual({ iconUrl: null, name: '' })
  })

  it('sends the whole normalized link list when one changed', () => {
    const draft = toDraft(SAVED)
    draft.fields = [
      { name: 'Website', value: 'https://anna.example' },
      { name: ' Photos ', value: ' https://photos.example ' },
      { name: '', value: '' }
    ]
    expect(buildProfilePatch(draft, SAVED)).toEqual({
      fields: [
        { name: 'Website', value: 'https://anna.example' },
        { name: 'Photos', value: 'https://photos.example' }
      ]
    })
  })
})

describe('getErrorField', () => {
  it.each([
    ['Invalid name', 'name'],
    ['Invalid summary', 'summary'],
    ['Invalid fields', 'fields'],
    ['Invalid fields.0.name', 'fields'],
    ['Invalid iconUrl', 'iconUrl'],
    ['Invalid headerImageUrl', 'headerImageUrl'],
    ['Invalid avatarDescription', 'avatarDescription'],
    ['Invalid headerDescription', 'headerDescription'],
    ['Invalid request', 'form'],
    ['Not found', 'form'],
    ['Invalid showReplies', 'form']
  ])('maps %j to %s', (message, field) => {
    expect(getErrorField(message)).toBe(field)
  })
})

describe('getPendingLinkValues', () => {
  it('is the new or changed links that came back unverified', () => {
    const after: SavedProfile = {
      ...SAVED,
      fields: [
        { name: 'Website', value: 'https://anna.example', verifiedAt: null },
        { name: 'Photos', value: 'https://photos.example', verifiedAt: null },
        {
          name: 'Blog',
          value: 'https://blog.example',
          verifiedAt: '2026-10-02T00:00:00.000Z'
        },
        { name: 'Where', value: 'Lisbon', verifiedAt: null }
      ]
    }
    // Website was already saved, so nothing new is being checked for it.
    expect(getPendingLinkValues(SAVED, after)).toEqual([
      'https://photos.example',
      'Lisbon'
    ])
  })
})

describe('describeChanges', () => {
  it('names one change', () => {
    expect(describeChanges(['summary'])).toBe('your bio')
  })

  it('joins several in page order, once each', () => {
    expect(
      describeChanges(['showFitness', 'fields', 'summary', 'showMedia'])
    ).toBe('your bio, your profile fields and your profile tabs')
    expect(describeChanges(['avatarDescription', 'headerDescription'])).toBe(
      'your image descriptions'
    )
  })
})
