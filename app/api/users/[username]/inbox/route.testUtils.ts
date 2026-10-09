import { NextRequest } from 'next/server'

export const createFollowRequest = (username = 'llun') =>
  new NextRequest(`https://activities.local/api/users/${username}/inbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'https://remote.test/users/alice/follows/1',
      type: 'Follow',
      actor: 'https://remote.test/users/alice',
      object: `https://activities.local/users/${username}`
    })
  })

export const createActorInboxActivityRequest = (type: string) =>
  new NextRequest('https://activities.local/api/users/llun/inbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: `https://remote.test/users/alice/activities/${type.toLowerCase()}`,
      type,
      actor: 'https://remote.test/users/alice',
      object: 'https://activities.local/users/llun'
    })
  })
