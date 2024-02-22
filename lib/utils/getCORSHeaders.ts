import { z } from 'zod'

import { headerHost } from '../services/guards/headerHost'

export const HttpMethod = z.enum([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'HEAD'
])
export type HttpMethod = z.infer<typeof HttpMethod>

export const getCORSHeaders = (methods: HttpMethod[], headers: Headers) => ({
  'Access-Control-Allow-Headers': 'authorization',
  'Access-Control-Allow-Methods': methods.join(','),
  'Access-Control-Allow-Origin':
    headers.get('origin') ?? `https://${headerHost(headers)}`
})
