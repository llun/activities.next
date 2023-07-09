import z from 'zod'

import { errorResponse } from '../../../lib/errors'
import { ApiGuard } from '../../../lib/guard'
import { ApiTrace } from '../../../lib/trace'

export const MediaSchema = z.object({})

const handler = ApiTrace(
  'v2/media',
  ApiGuard(async (req, res, context) => {
    switch (req.method) {
      case 'POST': {
        res.status(200).json({
          id: 1,
          type: 'image',
          url: '',
          preview_url: '',
          text_url: '',
          remote_Url: '',
          meta: {
            focus: {
              x: 0,
              y: 0
            },
            original: {
              width: 100,
              height: 100,
              size: '100x100',
              aspect: 1.3
            },
            small: {
              width: 50,
              height: 50,
              size: '50x50',
              aspect: 1.3
            }
          },
          description: '',
          blurhash: ''
        })
        return
      }
      default: {
        return errorResponse(res, 404)
      }
    }
  })
)

export default handler
