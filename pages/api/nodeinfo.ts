import type { NextApiRequest, NextApiResponse } from 'next'

type Data = {
  version: '2.0'
  software: {
    name: 'llun.activities'
    version: '1.0'
  }
  protocols: ['activitypub']
  usage: {
    users: {
      total: number
      activeMonth: number
      activeHalfyear: number
    }
    localPosts: number
  }
  openRegistrations: false
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  res.status(200).json({
    version: '2.0',
    software: {
      name: 'llun.activities',
      version: '1.0'
    },
    protocols: ['activitypub'],
    usage: {
      users: {
        total: 1,
        activeMonth: 1,
        activeHalfyear: 1
      },
      localPosts: 1
    },
    openRegistrations: false
  })
}
