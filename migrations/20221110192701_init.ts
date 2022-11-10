import { Knex } from 'knex'

/**
 *
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
  id: 'https://mastodon.in.th/users/llun/statuses/109315261170377200/activity',
  type: 'Create',
  actor: 'https://mastodon.in.th/users/llun',
  published: '2022-11-09T18:28:31Z',
  to: ['https://www.w3.org/ns/activitystreams#Public'],
  cc: [
    'https://mastodon.in.th/users/llun/followers',
    'https://chat.llun.in.th/users/llun'
  ],
  object: {
    id: 'https://mastodon.in.th/users/llun/statuses/109315261170377200',
    type: 'Note',
    summary: null,
    inReplyTo: null,
    published: '2022-11-09T18:28:31Z',
    url: 'https://mastodon.in.th/@llun/109315261170377200',
    attributedTo: 'https://mastodon.in.th/users/llun',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [
      'https://mastodon.in.th/users/llun/followers',
      'https://chat.llun.in.th/users/llun'
    ],
    sensitive: false,
    atomUri: 'https://mastodon.in.th/users/llun/statuses/109315261170377200',
    inReplyToAtomUri: null,
    conversation:
      'tag:mastodon.in.th,2022-11-09:objectId=5804403:objectType=Conversation',
    content:
      '\u003cp\u003e\u003cspan class="h-card"\u003e\u003ca href="https://chat.llun.in.th/@llun" class="u-url mention"\u003e@\u003cspan\u003ellun@chat.llun.in.th\u003c/span\u003e\u003c/a\u003e\u003c/span\u003e Test\u003c/p\u003e',
    contentMap: {
      th: '\u003cp\u003e\u003cspan class="h-card"\u003e\u003ca href="https://chat.llun.in.th/@llun" class="u-url mention"\u003e@\u003cspan\u003ellun@chat.llun.in.th\u003c/span\u003e\u003c/a\u003e\u003c/span\u003e Test\u003c/p\u003e'
    },
    attachment: [],
    tag: [
      {
        type: 'Mention',
        href: 'https://chat.llun.in.th/users/llun',
        name: '@llun@chat.llun.in.th'
      }
    ],
    replies: {
      id: 'https://mastodon.in.th/users/llun/statuses/109315261170377200/replies',
      type: 'Collection',
      first: {
        type: 'CollectionPage',
        next: 'https://mastodon.in.th/users/llun/statuses/109315261170377200/replies?only_other_accounts=true\u0026page=true',
        partOf:
          'https://mastodon.in.th/users/llun/statuses/109315261170377200/replies',
        items: []
      }
    }
  },
  signature: {
    type: 'RsaSignature2017',
    creator: 'https://mastodon.in.th/users/llun#main-key',
    created: '2022-11-09T18:28:37Z',
    signatureValue:
      'l9wDeDWL64pwhrVakHUkUjWrtTMGIjVn/ixEk0z3qOlzYwlSZE7t3GoFCL4CbV5ptw+IsyK0oirGLn3grhiFVkjtPF+S6vsmOZiWC0oDM4RfqtUS4VnY0pmJVnVsPyZKNp15mwov7/Tc+Gv2YkOO/+ftsU3paGJUYNR4xYkJVEA58pFB6iZp+2UcQ3IBB3d27eCxefMWQw/3rNrwJUtSAgO9ZFhngUrz/7DiR11QeOModWMDNj1WYU9cikS9j7pSUnVJbYTNssluZ7EnERnyPL+q11r+fQ2lnJ1I9kSoA8BviSpuTL/a1kVtbrGgzz/9XCwKtqJM7f4aqU03wU35BQ=='
  }
}
 */

export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .createTable('accounts', function (table) {
      table.string('id').primary()
      table.text('publicKey')
      table.text('privateKey')
    })
    .createTable('status', function (table) {
      table.string('id').primary()
      table.string('accountId').unsigned().notNullable()
      table.foreign('accountId').references('id').inTable('accounts')

      table.string('uri')
      table.string('url')
      table.text('text')
      table.text('summary')

      table.string('reply')
      table.boolean('sensitive')
      table.string('visibility')
      table.string('language')

      table.string('thread')
      table.string('conversation')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true })
    })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('status').dropTable('accounts')
}
