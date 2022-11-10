// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'

type Data = {
  name: string
}

const ApiHandler: NextApiHandler = (req, res) => {
  console.log('inbox', req.query, req.headers)
  console.log(req.body)

  // return 403 when verify signature fail

  const x = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      {
        ostatus: 'http://ostatus.org#',
        atomUri: 'ostatus:atomUri',
        inReplyToAtomUri: 'ostatus:inReplyToAtomUri',
        conversation: 'ostatus:conversation',
        sensitive: 'as:sensitive',
        toot: 'http://joinmastodon.org/ns#',
        votersCount: 'toot:votersCount'
      }
    ],
    id: 'https://glasgow.social/users/llun/statuses/109315196404546038/activity',
    type: 'Create',
    actor: 'https://glasgow.social/users/llun',
    published: '2022-11-09T18:12:03Z',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [
      'https://glasgow.social/users/llun/followers',
      'https://chat.llun.in.th/users/test'
    ],
    object: {
      id: 'https://glasgow.social/users/llun/statuses/109315196404546038',
      type: 'Note',
      summary: null,
      inReplyTo: null,
      published: '2022-11-09T18:12:03Z',
      url: 'https://glasgow.social/@llun/109315196404546038',
      attributedTo: 'https://glasgow.social/users/llun',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [
        'https://glasgow.social/users/llun/followers',
        'https://chat.llun.in.th/users/test'
      ],
      sensitive: false,
      atomUri: 'https://glasgow.social/users/llun/statuses/109315196404546038',
      inReplyToAtomUri: null,
      conversation:
        'tag:glasgow.social,2022-11-09:objectId=2967972:objectType=Conversation',
      content:
        '<p><span class="h-card"><a href="https://chat.llun.in.th/@test" class="u-url mention">@<span>test</span></a></span> Another test because of wrong hostname</p>',
      contentMap: {
        en: '<p><span class="h-card"><a href="https://chat.llun.in.th/@test" class="u-url mention">@<span>test</span></a></span> Another test because of wrong hostname</p>'
      },
      attachment: [],
      tag: [[Object]],
      replies: {
        id: 'https://glasgow.social/users/llun/statuses/109315196404546038/replies',
        type: 'Collection',
        first: [Object]
      }
    },
    signature: {
      type: 'RsaSignature2017',
      creator: 'https://glasgow.social/users/llun#main-key',
      created: '2022-11-09T18:12:04Z',
      signatureValue:
        'DTqKrAL9ZMaQbHZLIt2GjbO1pdrdMSj5DcA+1KB+crDnkVTEPu5tSGCWiJblC4rJaXGPsJXF1iRTodbhAPfRgT/wl27u85rbImETXTTfNTFI33vQnaAxE5fUoDVSiMCtJ1xUitBbR4kLOMx+grIsQLlZmCzpjOtqbhA32m7NCwB5yh50MkIjt/nNYMlxWfc0vXmoHz2ZkfNMi4iauQIzl4pDYSHFw5MdLbV78cubFu9OKrU4qqU98Bg6/VaU538lmluqZqLBHXGH1Z/H1uE0ql4xqhvUll/Okj030oiIlLWtYJkv3dgcSKjopRib/4pV3YnMJQHsMGuvRjfWwmDoig=='
    }
  }

  res.status(202).send('')
}
export default ApiHandler
