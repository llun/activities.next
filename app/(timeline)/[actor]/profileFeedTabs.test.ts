import { createAnnounceStatus, createStatus } from './ActorTimelines.testUtils'
import { getCreatedStatusTab, splitProfileFeeds } from './profileFeedTabs'

const ME = 'https://local.example/users/me'
const OTHER = 'https://remote.example/users/other'
const id = (name: string) => `https://local.example/statuses/${name}`

const top = createStatus(id('top'), { actorId: ME })
const selfReply = createStatus(id('self'), { actorId: ME, reply: id('top') })
const othersPost = createStatus(id('others'), { actorId: OTHER })
const toOther = createStatus(id('to-other'), {
  actorId: ME,
  reply: id('others')
})
const underOther = createStatus(id('under-other'), {
  actorId: ME,
  reply: id('to-other')
})
const boost = createAnnounceStatus(id('boost'), othersPost)

describe('splitProfileFeeds', () => {
  const statuses = [underOther, toOther, boost, selfReply, top]
  const names = (list: { id: string }[]) => list.map((status) => status.id)

  it('follows the server list on a local profile, newest first', () => {
    const { posts, replies } = splitProfileFeeds(
      statuses,
      new Set([underOther.id, toOther.id])
    )
    expect(names(posts)).toEqual([boost.id, selfReply.id, top.id])
    expect(names(replies)).toEqual([underOther.id, toOther.id])
  })

  it('puts every reply on Replies without a server list', () => {
    const { posts, replies } = splitProfileFeeds(statuses, null)
    expect(names(posts)).toEqual([boost.id, top.id])
    expect(names(replies)).toEqual([underOther.id, toOther.id, selfReply.id])
  })
})

describe('getCreatedStatusTab', () => {
  const loaded = [othersPost, underOther, toOther, boost, selfReply, top]
  const repliesTab = new Set([underOther.id, toOther.id])
  const written = (reply: string, actorId = ME) =>
    createStatus(id('new'), { actorId, reply })

  it.each([
    { description: 'a new post', status: written(''), tab: 'posts' },
    {
      description: 'a reply to an own post',
      status: written(id('top')),
      tab: 'posts'
    },
    {
      description: 'a reply to an own Posts reply',
      status: written(id('self')),
      tab: 'posts'
    },
    {
      description: 'a reply to an own Replies reply',
      status: written(id('under-other')),
      tab: 'replies'
    },
    {
      description: "a reply to someone else's post",
      status: written(id('others')),
      tab: 'replies'
    },
    {
      description: 'a reply to an unloaded post',
      status: written(id('gone')),
      tab: 'replies'
    },
    {
      description: 'a boost',
      status: createAnnounceStatus(id('new-boost'), top),
      tab: 'posts'
    }
  ])('puts $description on $tab', ({ status, tab }) => {
    expect(getCreatedStatusTab(status, loaded, repliesTab)).toBe(tab)
  })

  it('finds an own parent shown inside a boost', () => {
    const ownBoost = createAnnounceStatus(id('own-boost'), top)
    expect(getCreatedStatusTab(written(id('top')), [ownBoost], new Set())).toBe(
      'posts'
    )
  })
})
