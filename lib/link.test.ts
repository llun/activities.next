import { getMentions, linkifyText, paragraphText } from './link'
import { Actor } from './models/actor'
import { Sqlite3Storage } from './storage/sqlite3'
import { mockRequests } from './stub/activities'
import { ACTOR1_ID, seedActor1 } from './stub/seed/actor1'
import { seedActor2 } from './stub/seed/actor2'
import { seedStorage } from './stub/storage'

describe('#linkifyText', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('links mention with user url', async () => {
    const message = await linkifyText('@test1@somewhere.test')
    expect(message).toEqual(
      '<span class="h-card"><a href="https://somewhere.test/actors/test1" target="_blank" class="u-url mention">@<span>test1</span></a></span>'
    )
  })

  it('links multiple mentions with user url', async () => {
    const message = await linkifyText(
      'With multiple mentions @test1@somewhere.test and @test2@llun.test tags'
    )
    expect(message).toEqual(
      'With multiple mentions <span class="h-card"><a href="https://somewhere.test/actors/test1" target="_blank" class="u-url mention">@<span>test1</span></a></span> and <span class="h-card"><a href="https://llun.test/@test2" target="_blank" class="u-url mention">@<span>test2</span></a></span> tags'
    )
  })

  it('linkify http link', async () => {
    const message = await linkifyText(
      'Test linkify string https://www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/ with url'
    )
    expect(message).toEqual(
      'Test linkify string <a href="https://www.llun.me/posts/dev/2023-01-07-my-wrong-assumptions-with-activity-pub/" target="_blank" rel="nofollow noopener noreferrer">llun.me/posts/dev/2023-01-07-my-…</a> with url'
    )
  })

  it('linkify link without pathname', async () => {
    const message = await linkifyText(
      'Test linkify string llun.me, without pathname'
    )
    expect(message).toEqual(
      'Test linkify string <a href="https://llun.me" target="_blank" rel="nofollow noopener noreferrer">llun.me</a>, without pathname'
    )
  })
})

describe('#paragraphText', () => {
  it('returns single paragraph for single line text', () => {
    expect(paragraphText('This is single line text')).toEqual(
      `
<p>This is single line text</p>
`.trim()
    )
  })

  it('returns two paragraph for two line text', () => {
    expect(
      paragraphText(
        `
This is first line text
This is second line text
`.trim()
      )
    ).toEqual(
      `
<p>This is first line text<br />This is second line text</p>
`.trim()
    )
  })

  it('adds br when text has empty line in between', () => {
    expect(
      paragraphText(
        `
This is first line text

This is second line text
`.trim()
      )
    ).toEqual(
      `
<p>This is first line text</p>
<p>This is second line text</p>
`.trim()
    )
  })

  it('adds br when text has multple empty line in between', () => {
    expect(
      paragraphText(
        `
This is first line text


This is second line text
This is third line text
`.trim()
      )
    ).toEqual(
      `
<p>This is first line text</p>
<br />
<p>This is second line text<br />This is third line text</p>
`.trim()
    )
  })

  it('adds multiple br when text has multple empty line in between', () => {
    expect(
      paragraphText(
        `
This is first line text



This is second line text
This is third line text
`.trim()
      )
    ).toEqual(
      `
<p>This is first line text</p>
<br />
<br />
<p>This is second line text<br />This is third line text</p>
`.trim()
    )
  })

  it('adds multiple br when text has multple empty line in between', () => {
    expect(
      paragraphText(
        `
This is first line text


This is second line text
This is third line text

This is fourth line text
`.trim()
      )
    ).toEqual(
      `
<p>This is first line text</p>
<br />
<p>This is second line text<br />This is third line text</p>
<p>This is fourth line text</p>
`.trim()
    )
  })
})

describe('#getMentions', () => {
  const storage = new Sqlite3Storage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor1: Actor | undefined
  let actor2: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    actor1 = await storage.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    actor2 = await storage.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns empty array for text with no mentions', async () => {
    if (!actor1) fail('Actor1 is required')
    expect(
      await getMentions({
        text: 'Text without mentions',
        currentActor: actor1
      })
    ).toEqual([])
  })

  it('returns Mentions from text', async () => {
    if (!actor1) fail('Actor1 is required')
    const mentions = await getMentions({
      text: '@llun@somewhere.test @test1@llun.test Test mentions',
      currentActor: actor1
    })
    expect(mentions).toHaveLength(2)
    expect(mentions[0]).toEqual({
      type: 'Mention',
      href: `https://somewhere.test/actors/llun`,
      name: '@llun@somewhere.test'
    })
    expect(mentions[1]).toEqual({
      type: 'Mention',
      href: ACTOR1_ID,
      name: '@test1@llun.test'
    })
  })

  it('returns mention with hostname the same as actor when mention without hostname', async () => {
    if (!actor1) fail('Actor1 is required')
    const mentions = await getMentions({
      text: '@test2 Hello',
      currentActor: actor1
    })
    expect(mentions).toContainValue({
      type: 'Mention',
      href: actor2?.id,
      name: `@test2`
    })
  })

  it('returns no mentions if it cannot fetch user', async () => {
    if (!actor1) fail('Actor1 is required')
    const mentions = await getMentions({
      text: '@notexist@else Hello',
      currentActor: actor1
    })
    expect(mentions).toHaveLength(0)
  })

  it('returns single mentions if mentions more than once', async () => {
    if (!actor1) fail('Actor1 is required')

    const mentions = await getMentions({
      text: '@llun@somewhere.test @llun@somewhere.test Test mentions',
      currentActor: actor1
    })
    expect(mentions).toHaveLength(1)
    expect(mentions).toContainValue({
      type: 'Mention',
      href: `https://somewhere.test/actors/llun`,
      name: '@llun@somewhere.test'
    })
  })

  it('adds reply actor into mention', async () => {
    if (!actor1) fail('Actor1 is required')
    if (!actor2) fail('Actor2 is required')

    const status = await storage.getStatus({
      statusId: `${actor2.id}/statuses/post-2`
    })

    const mentions = await getMentions({
      text: '@llun@somewhere.test @llun@somewhere.test Test mentions',
      currentActor: actor1,
      replyStatus: status
    })
    expect(mentions).toHaveLength(2)
    expect(mentions).toContainValue({
      type: 'Mention',
      href: `https://somewhere.test/actors/llun`,
      name: '@llun@somewhere.test'
    })
    expect(mentions).toContainValue({
      type: 'Mention',
      href: actor2.id,
      name: actor2.getMention(true)
    })
  })
})
