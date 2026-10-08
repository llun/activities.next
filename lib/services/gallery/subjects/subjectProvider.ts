import { getConfig } from '@/lib/config'

// The vision endpoint that suggests a photo's subject: the alt text endpoint
// and key with an optional model override (`config.gallery.subjects`),
// null when alt text is not configured or subject suggestions are switched off.
export interface SubjectProviderConfig {
  endpoint: string
  apiKey: string
  model: string
}

export const getSubjectProviderConfig = (): SubjectProviderConfig | null =>
  getConfig().gallery.subjects
