// This schema is base on https://docs.joinmastodon.org/entities/MediaAttachment/
import { z } from 'zod'

import { Audio } from './audio'
import { Gifv } from './gifv'
import { Image } from './image'
import { Unknown } from './unknown'
import { Video } from './video'

export const MediaTypes = {
  Gifv,
  Image,
  Video,
  Audio,
  Unknown
}

export const MediaAttachment = z.union([Image, Gifv, Video, Audio, Unknown])
export type MediaAttachment = z.infer<typeof MediaAttachment>
