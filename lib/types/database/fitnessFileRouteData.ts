export interface FitnessFileRouteData {
  fitnessFileId: string
  actorId: string
  routeData: string
  sourceVersion: number
  createdAt: number
  updatedAt: number
}

export type FitnessFileRouteDataMetadata = Omit<
  FitnessFileRouteData,
  'routeData'
>
