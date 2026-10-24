import {
  entryPath,
  planArchiveActors,
  toSafeEntryName,
  toSafeSegment
} from './layout'

describe('planArchiveActors', () => {
  const actors = [
    { id: 'b', username: 'b', domain: 'llun.test' },
    { id: 'a', username: 'a', domain: 'llun.test' }
  ]

  it('puts the default profile first at the archive root', () => {
    const plan = planArchiveActors(actors, 'a')
    expect(plan.map((actor) => actor.id)).toEqual(['a', 'b'])
    expect(plan[0]).toMatchObject({
      isDefault: true,
      mastodonDir: '',
      dir: 'activities.next/actors/llun.test/a'
    })
    expect(plan[1]).toMatchObject({
      isDefault: false,
      mastodonDir: 'activities.next/actors/llun.test/b',
      dir: 'activities.next/actors/llun.test/b'
    })
  })

  it('falls back to the first actor when there is no default', () => {
    expect(planArchiveActors(actors, null)[0].id).toBe('b')
  })

  it('separates names that clean to the same directory', () => {
    const plan = planArchiveActors(
      [
        { id: '1', username: 'a.b', domain: 'x.test' },
        { id: '2', username: 'a_b', domain: 'x.test' },
        { id: '3', username: 'A_B', domain: 'x.test' }
      ],
      '1'
    )
    expect(new Set(plan.map((actor) => actor.dir.toLowerCase())).size).toBe(3)
  })

  it('keeps a username from escaping its folder', () => {
    const [plan] = planArchiveActors(
      [{ id: '1', username: '../../etc', domain: 'x.test:8443' }],
      '1'
    )
    expect(plan.dir.split('/')).not.toContain('..')
    expect(plan.dir.split('/')).toHaveLength(4)
  })
})

describe('toSafeSegment', () => {
  it('never returns an empty or dotted segment', () => {
    expect(toSafeSegment('')).toBe('_')
    expect(toSafeSegment('..')).toBe('_')
    expect(toSafeSegment('.hidden')).toBe('_hidden')
  })
})

describe('toSafeEntryName', () => {
  it.each(['../x', '/etc/passwd', 'a/../b', 'a\\b', 'a//b', '', 'a\0b'])(
    'refuses %j',
    (value) => {
      expect(toSafeEntryName(value)).toBeNull()
    }
  )

  it('keeps a plain relative path', () => {
    expect(toSafeEntryName('medias/2026/a.jpg')).toBe('medias/2026/a.jpg')
    expect(toSafeEntryName('./a.jpg')).toBe('a.jpg')
  })
})

describe('entryPath', () => {
  it('skips empty segments', () => {
    expect(entryPath('', 'a', '', 'b.json')).toBe('a/b.json')
  })
})
