export const GET = async () => {
  const data = {
    uri: 'llun.dev',
    title: 'Personal llun Mastodon',
    short_description: '',
    description: 'Experiment personal mastodon service with Next.js',
    email: '-',
    version: '1.0.0',
    urls: {
      streaming_api: 'wss://llun.dev/streaming'
    },
    stats: {
      user_count: 1,
      status_count: 1,
      domain_count: 1
    },
    thumbnail: '',
    languages: ['en', 'th'],
    registrations: false,
    approval_required: false,
    invites_enabled: false,
    configuration: {
      statuses: {
        max_characters: 500,
        max_media_attachments: 4,
        characters_reserved_per_url: 23
      },
      media_attachments: {
        supported_mime_types: ['image/jpeg', 'video/mp4'],
        image_size_limit: 10485760,
        image_matrix_limit: 16777216,
        video_size_limit: 41943040,
        video_frame_rate_limit: 60,
        video_matrix_limit: 2304000
      },
      polls: {
        max_options: 4,
        max_characters_per_option: 50,
        min_expiration: 300,
        max_expiration: 2629746
      }
    },
    contact_account: {
      id: '1',
      username: 'llun',
      acct: 'llun',
      display_name: 'llun',
      locked: false,
      bot: false,
      discoverable: false,
      group: false,
      created_at: '2019-02-18T00:00:00.000Z',
      note: '',
      url: 'https://llun.dev/@null',
      avatar: '',
      avatar_static: '',
      header: '',
      header_static: '',
      followers_count: 0,
      following_count: 0,
      statuses_count: 0,
      last_status_at: '2022-02-18',
      emojis: [],
      fields: []
    },
    rules: []
  }
  return Response.json(data)
}
