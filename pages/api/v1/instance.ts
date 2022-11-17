// {
//   "uri": "mastodon.in.th",
//   "title": "Mastodon Thailand",
//   "short_description": "",
//   "description": "ชุมชน Mastodon ในประเทศไทย",
//   "email": "-",
//   "version": "3.5.3",
//   "urls": {
//       "streaming_api": "wss://mastodon.in.th"
//   },
//   "stats": {
//       "user_count": 1060,
//       "status_count": 160098,
//       "domain_count": 8317
//   },
//   "thumbnail": "https://mastodon.in.th/packs/media/images/preview-5df98290371ead9a70bc3cd4733bbfa7.jpg",
//   "languages": [
//       "th"
//   ],
//   "registrations": true,
//   "approval_required": false,
//   "invites_enabled": false,
//   "configuration": {
//       "statuses": {
//           "max_characters": 500,
//           "max_media_attachments": 4,
//           "characters_reserved_per_url": 23
//       },
//       "media_attachments": {
//           "supported_mime_types": [
//               "image/jpeg",
//               "image/png",
//               "image/gif",
//               "video/webm",
//               "video/mp4",
//               "video/quicktime",
//               "video/ogg",
//               "audio/wave",
//               "audio/wav",
//               "audio/x-wav",
//               "audio/x-pn-wave",
//               "audio/ogg",
//               "audio/vorbis",
//               "audio/mpeg",
//               "audio/mp3",
//               "audio/webm",
//               "audio/flac",
//               "audio/aac",
//               "audio/m4a",
//               "audio/x-m4a",
//               "audio/mp4",
//               "audio/3gpp",
//               "video/x-ms-asf"
//           ],
//           "image_size_limit": 10485760,
//           "image_matrix_limit": 16777216,
//           "video_size_limit": 41943040,
//           "video_frame_rate_limit": 60,
//           "video_matrix_limit": 2304000
//       },
//       "polls": {
//           "max_options": 4,
//           "max_characters_per_option": 50,
//           "min_expiration": 300,
//           "max_expiration": 2629746
//       }
//   },
//   "contact_account": {
//       "id": "1",
//       "username": "admin",
//       "acct": "admin",
//       "display_name": "Mastodon Thailand",
//       "locked": false,
//       "bot": false,
//       "discoverable": false,
//       "group": false,
//       "created_at": "2019-02-18T00:00:00.000Z",
//       "note": "",
//       "url": "https://mastodon.in.th/@admin",
//       "avatar": "https://mastodon-thailand.sgp1.digitaloceanspaces.com/accounts/avatars/000/000/001/original/e6da9dda41decfcf.png",
//       "avatar_static": "https://mastodon-thailand.sgp1.digitaloceanspaces.com/accounts/avatars/000/000/001/original/e6da9dda41decfcf.png",
//       "header": "https://mastodon-thailand.sgp1.digitaloceanspaces.com/accounts/headers/000/000/001/original/63a268264a0d45ee.png",
//       "header_static": "https://mastodon-thailand.sgp1.digitaloceanspaces.com/accounts/headers/000/000/001/original/63a268264a0d45ee.png",
//       "followers_count": 773,
//       "following_count": 0,
//       "statuses_count": 6,
//       "last_status_at": "2022-02-18",
//       "emojis": [],
//       "fields": [
//           {
//               "name": "Telegram",
//               "value": "<a href=\"https://t.me/ThailandFediverseCommunity\" target=\"_blank\" rel=\"nofollow noopener noreferrer me\"><span class=\"invisible\">https://</span><span class=\"ellipsis\">t.me/ThailandFediverseCommunit</span><span class=\"invisible\">y</span></a>",
//               "verified_at": null
//           }
//       ]
//   },
//   "rules": [
//       {
//           "id": "1",
//           "text": "ห้ามการกระทำที่เป็นการสแปม รบกวน ละเมิดความเป็นส่วนตัว ก่อให้เกิดความไม่ปลอดภัย หรือสร้างความเสียหายต่อผู้อื่น"
//       },
//       {
//           "id": "4",
//           "text": "ห้ามข่าวปลอมหรือทฤษฎีสมคบคิดที่ขัดกับหลักฐานทางวิทยาศาสตร์"
//       },
//       {
//           "id": "5",
//           "text": "ห้ามเนื้อหาผิดลิขสิทธิ์ ละเมิดทรัพย์สินทางปัญญา หรือขัดต่อกฎหมาย"
//       },
//       {
//           "id": "2",
//           "text": "ห้ามคำพูดสร้างความเกลียดชัง หยาบคาย ยุยง ปลุกปั่น กลั่นแกล้ง หลอกลวง ดูหมิ่น เหยียด แบ่งแยก ข่มขู่ คุกคาม ล่อลวง ล่วงละเมิด หรือประสงค์ร้าย"
//       },
//       {
//           "id": "3",
//           "text": "ห้ามรูปภาพและวิดีโอที่ไม่พึงประสงค์ สื่ออนาจาร อุจาด ความรุนแรง สยดสยอง ขยะแขยง หรือมีผลกระทบต่อผู้มีโรคประจำตัว เช่น โรคลมชัก (Epilepsy), โรคกลัวรู (Trypophobia)"
//       }
//   ]
// }
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'

type Data = {
  uri: string
  title: string
  short_description: string
  description: string
  email: string
  version: string
  urls: {
    streaming_api: string
  }
  stats: {
    user_count: number
    status_count: number
    domain_count: number
  }
  thumbnail: string
  languages: string[]
  registrations: boolean
  approval_required: boolean
  invites_enabled: boolean
  configuration: {
    statuses: {
      max_characters: number
      max_media_attachments: number
      characters_reserved_per_url: number
    }
    media_attachments: {
      supported_mime_types: string[]
      image_size_limit: number
      image_matrix_limit: number
      video_size_limit: number
      video_frame_rate_limit: number
      video_matrix_limit: number
    }
    polls: {
      max_options: number
      max_characters_per_option: number
      min_expiration: number
      max_expiration: number
    }
  }
  contact_account: {
    id: string
    username: string
    acct: string
    display_name: string
    locked: boolean
    bot: boolean
    discoverable: boolean
    group: boolean
    created_at: string
    note: string
    url: string
    avatar: string
    avatar_static: string
    header: string
    header_static: string
    followers_count: number
    following_count: number
    statuses_count: number
    last_status_at: string
    emojis: string[]
    fields: { name: string; value: string; verified_at: string | null }[]
  }
  rules: { id: string; text: string }[]
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  res.status(200).json({
    uri: 'chat.llun.in.th',
    title: 'Personal llun Mastodon',
    short_description: '',
    description: 'Experiment personal mastodon service with Next.js',
    email: '-',
    version: '1.0.0',
    urls: {
      streaming_api: 'wss://chat.llun.in.th'
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
        supported_mime_types: [
          'image/jpeg',
          'image/png',
          'image/gif',
          'video/webm',
          'video/mp4',
          'video/quicktime',
          'video/ogg',
          'audio/wave',
          'audio/wav',
          'audio/x-wav',
          'audio/x-pn-wave',
          'audio/ogg',
          'audio/vorbis',
          'audio/mpeg',
          'audio/mp3',
          'audio/webm',
          'audio/flac',
          'audio/aac',
          'audio/m4a',
          'audio/x-m4a',
          'audio/mp4',
          'audio/3gpp',
          'video/x-ms-asf'
        ],
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
      url: 'https://chat.mastodon.in.th/@llun',
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
  })
}
