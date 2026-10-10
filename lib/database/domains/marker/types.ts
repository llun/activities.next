// Parameter and result types of the marker domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export type MarkerTimeline = 'home' | 'notifications'

export interface MarkerRow {
  actorId: string
  timeline: MarkerTimeline
  lastReadId: string
  version: number
  updatedAt: number
}

export interface GetMarkersParams {
  actorId: string
  timelines: MarkerTimeline[]
}

export interface UpsertMarkerParams {
  actorId: string
  timeline: MarkerTimeline
  lastReadId: string
}

export interface MarkerDatabase {
  getMarkers(params: GetMarkersParams): Promise<MarkerRow[]>
  upsertMarker(params: UpsertMarkerParams): Promise<MarkerRow>
}
