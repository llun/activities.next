// https://docs.joinmastodon.org/entities/Marker/
export interface Marker {
  last_read_id: string
  version: number
  updated_at: string
}

export type Markers = Partial<Record<'home' | 'notifications', Marker>>
