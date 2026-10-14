'use client'

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState
} from 'react'

import {
  type StatusFitnessFileItem,
  getFitnessFilesByStatus
} from '@/lib/client'
import { StatusNote } from '@/lib/types/domain/status'
import { sortStatusFitnessFiles } from '@/lib/utils/fitness'

export interface StatusFitnessFiles {
  fitnessFiles: StatusFitnessFileItem[]
  setFitnessFiles: Dispatch<SetStateAction<StatusFitnessFileItem[]>>
  selectedFitnessFileId: string | null
  setSelectedFitnessFileId: Dispatch<SetStateAction<string | null>>
  /** The recording on screen: the selected one, else the first. */
  fitness: StatusFitnessFileItem | undefined
}

/**
 * The recordings of a fitness post and which one is on screen. Starts from the
 * server's list (or a single placeholder built from the status payload) and,
 * when the server sent none, fetches the list once.
 */
export const useStatusFitnessFiles = (
  status: StatusNote,
  initialFitnessFiles?: StatusFitnessFileItem[]
): StatusFitnessFiles => {
  const defaultFitnessFiles = useMemo<StatusFitnessFileItem[]>(() => {
    if (!status.fitness) {
      return []
    }

    return [
      {
        id: status.fitness.id,
        actorId: status.actorId,
        fileName: status.fitness.fileName,
        fileType: status.fitness.fileType,
        statusId: status.id,
        isPrimary: true,
        processingStatus: status.fitness.processingStatus ?? 'pending',
        totalDistanceMeters: status.fitness.totalDistanceMeters ?? null,
        totalDurationSeconds: status.fitness.totalDurationSeconds ?? null,
        movingTimeSeconds: status.fitness.movingTimeSeconds ?? null,
        elevationGainMeters: status.fitness.elevationGainMeters ?? null,
        activityType: status.fitness.activityType ?? null,
        // Must come off the payload, not from `status.createdAt`: a Strava
        // webhook import is stamped when it published rather than when the ride
        // began, so a post-time stand-in dates the activity wrongly until the
        // by-status fetch below replaces this placeholder. The `??` arm is only
        // a shape default — the single fallback that actually renders is the one
        // on `activityStartTime` further down, which this deliberately mirrors
        // rather than pre-empts.
        activityStartTime: status.fitness.activityStartTime ?? status.createdAt,
        hasMapData: status.fitness.hasMapData ?? false,
        description: status.fitness.description ?? null,
        deviceManufacturer: status.fitness.deviceManufacturer ?? null,
        deviceName: status.fitness.deviceName ?? null,
        sourceUrl: status.fitness.sourceUrl ?? null,
        gearId: status.fitness.gearId ?? null,
        gearName: status.fitness.gearName ?? null,
        deviceGearId: status.fitness.deviceGearId ?? null,
        deviceGearName: status.fitness.deviceGearName ?? null,
        avgPower: status.fitness.avgPower ?? null,
        maxPower: status.fitness.maxPower ?? null,
        avgHeartRate: status.fitness.avgHeartRate ?? null,
        maxHeartRate: status.fitness.maxHeartRate ?? null,
        totalWorkKj: status.fitness.totalWorkKj ?? null,
        elevationSeries: status.fitness.elevationSeries ?? null
      }
    ]
  }, [
    status.actorId,
    status.createdAt,
    status.id,
    status.fitness?.id,
    status.fitness?.fileName,
    status.fitness?.fileType,
    status.fitness?.processingStatus,
    status.fitness?.totalDistanceMeters,
    status.fitness?.totalDurationSeconds,
    status.fitness?.movingTimeSeconds,
    status.fitness?.elevationGainMeters,
    status.fitness?.activityType,
    status.fitness?.activityStartTime,
    status.fitness?.hasMapData,
    status.fitness?.description,
    status.fitness?.deviceManufacturer,
    status.fitness?.deviceName,
    status.fitness?.sourceUrl,
    status.fitness?.gearId,
    status.fitness?.gearName,
    status.fitness?.deviceGearId,
    status.fitness?.deviceGearName,
    status.fitness?.avgPower,
    status.fitness?.maxPower,
    status.fitness?.avgHeartRate,
    status.fitness?.maxHeartRate,
    status.fitness?.totalWorkKj,
    status.fitness?.elevationSeries
  ])

  const initialFiles = useMemo(() => {
    const source =
      initialFitnessFiles && initialFitnessFiles.length > 0
        ? initialFitnessFiles
        : defaultFitnessFiles
    return sortStatusFitnessFiles(source)
  }, [initialFitnessFiles, defaultFitnessFiles])

  const [fitnessFiles, setFitnessFiles] =
    useState<StatusFitnessFileItem[]>(initialFiles)
  const [selectedFitnessFileId, setSelectedFitnessFileId] = useState<
    string | null
  >(() => {
    const primary = initialFiles.find((item) => item.isPrimary)
    return primary?.id ?? initialFiles[0]?.id ?? null
  })

  useEffect(() => {
    setFitnessFiles(initialFiles)
    setSelectedFitnessFileId((current) => {
      if (current && initialFiles.some((item) => item.id === current)) {
        return current
      }
      return (
        initialFiles.find((item) => item.isPrimary)?.id ??
        initialFiles[0]?.id ??
        null
      )
    })
  }, [initialFiles])

  useEffect(() => {
    if (initialFitnessFiles && initialFitnessFiles.length > 0) return

    let cancelled = false

    const loadFitnessFiles = async () => {
      try {
        const files = await getFitnessFilesByStatus(status.id)
        if (cancelled || !files || files.length === 0) return

        const ordered = sortStatusFitnessFiles(files)

        setFitnessFiles(ordered)
        setSelectedFitnessFileId((current) => {
          if (current && ordered.some((item) => item.id === current)) {
            return current
          }
          return ordered.find((item) => item.isPrimary)?.id ?? ordered[0].id
        })
      } catch {
        // Keep the status payload fallback if the list endpoint is unavailable.
      }
    }

    void loadFitnessFiles()

    return () => {
      cancelled = true
    }
  }, [status.id, initialFitnessFiles])

  const fitness = useMemo(
    () =>
      fitnessFiles.find((item) => item.id === selectedFitnessFileId) ??
      fitnessFiles[0],
    [fitnessFiles, selectedFitnessFileId]
  )

  return {
    fitnessFiles,
    setFitnessFiles,
    selectedFitnessFileId,
    setSelectedFitnessFileId,
    fitness
  }
}
