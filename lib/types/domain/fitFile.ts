import { z } from 'zod'

export const UploadedFitFile = z.object({
  name: z.string().min(1),
  contentBase64: z.string().min(1)
})

export type UploadedFitFile = z.infer<typeof UploadedFitFile>
