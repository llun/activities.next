import { z } from 'zod'

export const PostRequest = z.object({
  client_name: z.string(),
  redirect_uris: z.string(),
  scopes: z.string().optional(),
  website: z.string().optional()
})
export type PostRequest = z.infer<typeof PostRequest>

export const SuccessResponse = z.object({
  type: z.literal('success'),
  id: z.string(),
  name: z.string(),
  website: z.string().optional(),
  redirect_uri: z.string(),
  client_id: z.string(),
  client_secret: z.string()
})
export type SuccessResponse = z.infer<typeof SuccessResponse>

export const ErrorResponse = z.object({
  type: z.literal('error'),
  error: z.string()
})
export type ErrorResponse = z.infer<typeof ErrorResponse>

export const PostResponse = z.union([SuccessResponse, ErrorResponse])
export type PostResponse = z.infer<typeof PostResponse>
