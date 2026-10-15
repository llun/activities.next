import type {
  FitnessFileRouteData,
  FitnessFileRouteDataMetadata
} from '@/lib/types/database/fitnessFileRouteData'

export interface CreateFitnessFileRouteDataParams {
  fitnessFileId: string
  actorId: string
  routeData: string
  sourceVersion?: number
}

export type UpsertFitnessFileRouteDataParams = CreateFitnessFileRouteDataParams

export interface GetFitnessFileRouteDataParams {
  fitnessFileId: string
}

export interface DeleteFitnessFileRouteDataParams {
  fitnessFileId: string
}

export interface FitnessFileRouteDataDatabase {
  createFitnessFileRouteData(
    params: CreateFitnessFileRouteDataParams
  ): Promise<FitnessFileRouteData>
  upsertFitnessFileRouteData(
    params: UpsertFitnessFileRouteDataParams
  ): Promise<FitnessFileRouteData>
  getFitnessFileRouteData(
    params: GetFitnessFileRouteDataParams
  ): Promise<FitnessFileRouteData | null>
  getFitnessFileRouteDataMetadata(
    params: GetFitnessFileRouteDataParams
  ): Promise<FitnessFileRouteDataMetadata | null>
  deleteFitnessFileRouteData(
    params: DeleteFitnessFileRouteDataParams
  ): Promise<boolean>
}
