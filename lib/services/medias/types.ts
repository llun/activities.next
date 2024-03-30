import { z } from 'zod'

import { getConfig } from '@/lib/config'

import { MediaStorageConfig } from '../../config/mediaStorage'
import { Actor } from '../../models/actor'
import { Storage } from '../../storage/types'
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE } from './constants'

export type VideoProbe = {
  index: number
  codec_name: string
  codec_long_name: string
  profile: string
  codec_type: 'video'
  codec_tag_string: string
  codec_tag: string
  width: number
  height: number
  coded_width: number
  coded_height: number
  closed_captions: number
  film_grain: number
  has_b_frames: number
  sample_aspect_ratio: string
  display_aspect_ratio: string
  pix_fmt: string
  level: number
  color_range: string
  color_space: string
  color_transfer: string
  color_primaries: string
  chroma_location: string
  field_order: string
  refs: number
  is_avc: string
  nal_length_size: number
  id: string
  r_frame_rate: string
  avg_frame_rate: string
  time_base: string
  start_pts: number
  start_time: number
  duration_ts: number
  duration: number
  bit_rate: number
  max_bit_rate: string
  bits_per_raw_sample: number
  nb_frames: number
  nb_read_frames: string
  nb_read_packets: string
  extradata_size: number
}

export type AudioProbe = {
  index: number
  codec_name: string
  codec_long_name: string
  profile: string
  codec_type: 'audio'
  codec_tag_string: string
  codec_tag: string
  sample_fmt: string
  sample_rate: number
  channels: number
  channel_layout: string
  bits_per_sample: number
  initial_padding: number
  id: string
  r_frame_rate: string
  avg_frame_rate: string
  time_base: string
  start_pts: number
  start_time: number
  duration_ts: number
  duration: number
  bit_rate: number
  max_bit_rate: string
  bits_per_raw_sample: string
  nb_frames: number
  nb_read_frames: string
  nb_read_packets: string
  extradata_size: number
}

export type Probe = AudioProbe | VideoProbe

export type Format = {
  filename: string
  nb_streams: number
  nb_programs: number
  format_name: string
  format_long_name: string
  start_time: number
  duration: number
  size: string
  bit_rate: string
  probe_score: number
  tags: {
    major_brand: string
    minor_version: string
    compatible_brands: string
    encoder: string
  }
}

export type FFProbe = {
  streams: Probe[]
  format: Format
}

export const FileSchema = z
  .custom<File>()
  .refine((file) => {
    const config = getConfig()
    return file.size <= (config.mediaStorage?.maxFileSize ?? MAX_FILE_SIZE)
  }, 'File is larger than the limit.')
  .refine(
    (file) => ACCEPTED_FILE_TYPES.includes(file.type),
    `Only ${ACCEPTED_FILE_TYPES.join(',')} are accepted`
  )
export type FileSchema = z.infer<typeof FileSchema>

export const MediaSchema = z.object({
  file: FileSchema,
  thumbnail: FileSchema.optional(),
  description: z.string().optional()
})
export type MediaSchema = z.infer<typeof MediaSchema>

interface MediaMeta {
  width: number
  height: number
  size: `${number}x${number}`
  aspect: number
}
export interface MediaStorageSaveFileOutput {
  id: string
  type: 'image' | 'video'
  // Non-mastodon property
  mime_type: string
  url: string
  preview_url: string
  text_url: string
  remote_url: string
  meta: {
    original: MediaMeta
    small?: MediaMeta
  }
  description: string
}
export type MediaStorageSaveFile = (
  config: MediaStorageConfig,
  host: string,
  storage: Storage,
  actor: Actor,
  media: MediaSchema
) => Promise<MediaStorageSaveFileOutput | null>

export interface MediaStorageGetFileOutput {
  type: 'buffer'
  buffer: Buffer
  contentType: string
}

export interface MediaStorageGetRedirectOutput {
  type: 'redirect'
  redirectUrl: string
}

export type MediaStorageGetFile = (
  config: MediaStorageConfig,
  filePath: string
) => Promise<MediaStorageGetFileOutput | MediaStorageGetRedirectOutput | null>
