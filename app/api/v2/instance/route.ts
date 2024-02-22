import { getConfig } from "@/lib/config"
import { VERSION } from "@/lib/constants"
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE } from "@/lib/services/medias/constants"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const config = getConfig()
  return Response.json({
    "domain": config.host,
    "title": config.serviceName ?? 'Activities.next',
    "version": VERSION,
    "source_url": "https://github.com/llun/activities.next",
    "description": config.serviceDescription ?? 'Personal activity pub server with Next.js',
    "languages": config.languages,
    "configuration": {
      "accounts": {
        "max_featured_tags": 10
      },
      "statuses": {
        "max_characters": 500,
        "max_media_attachments": 4,
        "characters_reserved_per_url": 23
      },
      "media_attachments": {
        "supported_mime_types": ACCEPTED_FILE_TYPES,
        "image_size_limit": MAX_FILE_SIZE,
        "image_matrix_limit": 33177600,
        "video_size_limit": MAX_FILE_SIZE,
        "video_frame_rate_limit": 120,
        "video_matrix_limit": 8294400
      },
      "polls": {
        "max_options": 4,
        "max_characters_per_option": 50,
        "min_expiration": 300,
        "max_expiration": 2629746
      },
      "translation": {
        "enabled": false
      }
    },
    "registrations": {
      "enabled": false,
      "approval_required": false,
      "message": null,
      "url": null
    }
  })
}