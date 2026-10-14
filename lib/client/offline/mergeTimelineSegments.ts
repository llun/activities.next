import { reconcileStatusesMetadata } from '@/lib/components/posts/statusArray'
import { Status, StatusType } from '@/lib/types/domain/status'

import {
  HydratedTimelineSegment,
  MAX_CACHED_STATUSES_PER_TIMELINE
} from './types'

export const trimSegmentsToMax = (
  segments: HydratedTimelineSegment[],
  maxStatuses: number
): HydratedTimelineSegment[] => {
  if (maxStatuses <= 0) {
    return []
  }
  let remaining = maxStatuses
  const result: HydratedTimelineSegment[] = []

  for (const seg of segments) {
    if (remaining <= 0) break
    if (seg.statuses.length <= remaining) {
      result.push(seg)
      remaining -= seg.statuses.length
    } else {
      const trimmedStatuses = seg.statuses.slice(0, remaining)
      const lastStatus = trimmedStatuses[trimmedStatuses.length - 1]
      result.push({
        ...seg,
        statuses: trimmedStatuses,
        nextMaxStatusId: lastStatus ? lastStatus.id : seg.nextMaxStatusId
      })
      break
    }
  }

  return result
}

export const mergeFreshPageIntoSegments = (params: {
  currentSegments: HydratedTimelineSegment[]
  incomingStatuses: Status[]
  incomingNextMaxStatusId: string | null
  incomingPrevMinStatusId?: string | null
  maxStatuses?: number
}): {
  segments: HydratedTimelineSegment[]
  statuses: Status[]
  hasGap: boolean
  addedNewerCount: number
} => {
  const {
    currentSegments,
    incomingStatuses,
    incomingNextMaxStatusId,
    incomingPrevMinStatusId,
    maxStatuses = MAX_CACHED_STATUSES_PER_TIMELINE
  } = params

  if (incomingStatuses.length === 0) {
    const statuses = currentSegments.flatMap((s) => s.statuses)
    return {
      segments: currentSegments,
      statuses,
      hasGap: false,
      addedNewerCount: 0
    }
  }

  if (
    currentSegments.length === 0 ||
    currentSegments.every((s) => s.statuses.length === 0)
  ) {
    const singleSegment: HydratedTimelineSegment = {
      statuses: incomingStatuses,
      nextMaxStatusId: incomingNextMaxStatusId,
      prevMinStatusId:
        incomingPrevMinStatusId ?? incomingStatuses[0]?.id ?? null
    }
    const trimmed = trimSegmentsToMax([singleSegment], maxStatuses)
    return {
      segments: trimmed,
      statuses: trimmed.flatMap((s) => s.statuses),
      hasGap: false,
      addedNewerCount: incomingStatuses.length
    }
  }

  const topSegment = currentSegments[0]
  const topStatusIdMap = new Map(
    topSegment.statuses.map((s, idx) => [s.id, idx])
  )
  const firstTopId = topSegment.statuses[0]?.id

  let firstOverlapIncomingIdx = -1
  for (let i = 0; i < incomingStatuses.length; i++) {
    if (topStatusIdMap.has(incomingStatuses[i].id)) {
      firstOverlapIncomingIdx = i
      break
    }
  }

  const cursorAdjacent =
    incomingNextMaxStatusId !== null &&
    firstTopId !== undefined &&
    incomingNextMaxStatusId === firstTopId

  const hasOverlap = firstOverlapIncomingIdx !== -1 || cursorAdjacent

  if (!hasOverlap) {
    const incomingIdSet = new Set(incomingStatuses.map((s) => s.id))
    const updatedLowerSegments: HydratedTimelineSegment[] = []

    for (const seg of currentSegments) {
      const filteredStatuses = seg.statuses.filter(
        (s) => !incomingIdSet.has(s.id)
      )
      if (filteredStatuses.length > 0) {
        updatedLowerSegments.push({
          ...seg,
          statuses: filteredStatuses
        })
      }
    }

    const newTopSegment: HydratedTimelineSegment = {
      statuses: incomingStatuses,
      nextMaxStatusId: incomingNextMaxStatusId,
      prevMinStatusId:
        incomingPrevMinStatusId ?? incomingStatuses[0]?.id ?? null
    }

    const combinedSegments = [newTopSegment, ...updatedLowerSegments]
    const trimmed = trimSegmentsToMax(combinedSegments, maxStatuses)

    return {
      segments: trimmed,
      statuses: trimmed.flatMap((s) => s.statuses),
      hasGap: true,
      addedNewerCount: incomingStatuses.length
    }
  }

  const addedNewerCount =
    firstOverlapIncomingIdx !== -1
      ? firstOverlapIncomingIdx
      : incomingStatuses.length

  const newerStatuses = incomingStatuses.slice(0, addedNewerCount)
  const incomingById = new Map(incomingStatuses.map((s) => [s.id, s]))

  const updatedTopStatuses = topSegment.statuses.map((existing) => {
    const incoming = incomingById.get(existing.id)
    if (incoming) {
      return reconcileStatusesMetadata([incoming], [existing])[0]
    }
    return existing
  })

  let lastOverlapIncomingIdx = -1
  for (let i = incomingStatuses.length - 1; i >= 0; i--) {
    if (topStatusIdMap.has(incomingStatuses[i].id)) {
      lastOverlapIncomingIdx = i
      break
    }
  }

  const extendedOlderStatuses: Status[] = []
  if (
    lastOverlapIncomingIdx !== -1 &&
    lastOverlapIncomingIdx < incomingStatuses.length - 1
  ) {
    const candidateOlder = incomingStatuses.slice(lastOverlapIncomingIdx + 1)
    for (const st of candidateOlder) {
      if (!topStatusIdMap.has(st.id)) {
        extendedOlderStatuses.push(st)
      }
    }
  }

  const mergedTopStatuses = [
    ...newerStatuses,
    ...updatedTopStatuses,
    ...extendedOlderStatuses
  ]

  let mergedNextMaxStatusId = topSegment.nextMaxStatusId
  if (extendedOlderStatuses.length > 0) {
    mergedNextMaxStatusId = incomingNextMaxStatusId
  }

  const mergedTopSegment: HydratedTimelineSegment = {
    statuses: mergedTopStatuses,
    prevMinStatusId:
      incomingPrevMinStatusId ??
      mergedTopStatuses[0]?.id ??
      topSegment.prevMinStatusId,
    nextMaxStatusId: mergedNextMaxStatusId
  }

  const remainingSegments = currentSegments.slice(1)
  const finalSegments: HydratedTimelineSegment[] = []

  let currentMerged = mergedTopSegment
  let i = 0
  while (i < remainingSegments.length) {
    const nextSeg = remainingSegments[i]
    const nextStatusIds = new Set(nextSeg.statuses.map((s) => s.id))
    const firstNextStatusId = nextSeg.statuses[0]?.id

    const bridgesByStatus = currentMerged.statuses.some((s) =>
      nextStatusIds.has(s.id)
    )
    const bridgesByCursor =
      (currentMerged.nextMaxStatusId !== null &&
        firstNextStatusId !== undefined &&
        currentMerged.nextMaxStatusId === firstNextStatusId) ||
      currentMerged.nextMaxStatusId === null

    if (bridgesByStatus || bridgesByCursor) {
      const currentIds = new Set(currentMerged.statuses.map((s) => s.id))
      const combinedStatuses = [...currentMerged.statuses]
      for (const st of nextSeg.statuses) {
        if (!currentIds.has(st.id)) {
          combinedStatuses.push(st)
        }
      }
      currentMerged = {
        statuses: combinedStatuses,
        prevMinStatusId: currentMerged.prevMinStatusId,
        nextMaxStatusId: nextSeg.nextMaxStatusId
      }
      i++
    } else {
      break
    }
  }

  finalSegments.push(currentMerged)
  while (i < remainingSegments.length) {
    finalSegments.push(remainingSegments[i])
    i++
  }

  const trimmed = trimSegmentsToMax(finalSegments, maxStatuses)
  return {
    segments: trimmed,
    statuses: trimmed.flatMap((s) => s.statuses),
    hasGap: false,
    addedNewerCount
  }
}

export const mergeGapPageIntoSegments = (params: {
  currentSegments: HydratedTimelineSegment[]
  segmentIndex: number
  incomingStatuses: Status[]
  incomingNextMaxStatusId: string | null
  maxStatuses?: number
}): {
  segments: HydratedTimelineSegment[]
  statuses: Status[]
} => {
  const {
    currentSegments,
    segmentIndex,
    incomingStatuses,
    incomingNextMaxStatusId,
    maxStatuses = MAX_CACHED_STATUSES_PER_TIMELINE
  } = params

  if (segmentIndex < 0 || segmentIndex >= currentSegments.length) {
    const trimmed = trimSegmentsToMax(currentSegments, maxStatuses)
    return { segments: trimmed, statuses: trimmed.flatMap((s) => s.statuses) }
  }

  const currSeg = currentSegments[segmentIndex]
  const nextSeg =
    segmentIndex + 1 < currentSegments.length
      ? currentSegments[segmentIndex + 1]
      : null

  const currStatusMap = new Map(currSeg.statuses.map((s) => [s.id, s]))
  const incomingMap = new Map(incomingStatuses.map((s) => [s.id, s]))

  const updatedCurrStatuses = currSeg.statuses.map((existing) => {
    const incoming = incomingMap.get(existing.id)
    if (incoming) {
      return reconcileStatusesMetadata([incoming], [existing])[0]
    }
    return existing
  })

  const appendedStatuses: Status[] = []
  for (const st of incomingStatuses) {
    if (!currStatusMap.has(st.id)) {
      appendedStatuses.push(st)
    }
  }

  const mergedCurrStatuses = [...updatedCurrStatuses, ...appendedStatuses]

  let didBridge = false
  let mergedWithNextSegment: HydratedTimelineSegment | null = null

  if (nextSeg) {
    const nextIds = new Set(nextSeg.statuses.map((s) => s.id))
    const firstNextId = nextSeg.statuses[0]?.id

    const overlapsWithNext =
      incomingStatuses.some((s) => nextIds.has(s.id)) ||
      mergedCurrStatuses.some((s) => nextIds.has(s.id)) ||
      incomingNextMaxStatusId === null ||
      (incomingNextMaxStatusId !== null &&
        firstNextId !== undefined &&
        incomingNextMaxStatusId === firstNextId)

    if (overlapsWithNext) {
      didBridge = true
      const mergedCurrIds = new Set(mergedCurrStatuses.map((s) => s.id))
      const combined = [...mergedCurrStatuses]
      for (const st of nextSeg.statuses) {
        if (!mergedCurrIds.has(st.id)) {
          combined.push(st)
        }
      }
      mergedWithNextSegment = {
        statuses: combined,
        prevMinStatusId: currSeg.prevMinStatusId,
        nextMaxStatusId: nextSeg.nextMaxStatusId
      }
    }
  }

  const updatedSegments: HydratedTimelineSegment[] = []
  for (let i = 0; i < currentSegments.length; i++) {
    if (i < segmentIndex) {
      updatedSegments.push(currentSegments[i])
    } else if (i === segmentIndex) {
      if (didBridge && mergedWithNextSegment) {
        updatedSegments.push(mergedWithNextSegment)
        i++
      } else {
        updatedSegments.push({
          statuses: mergedCurrStatuses,
          prevMinStatusId: currSeg.prevMinStatusId,
          nextMaxStatusId: incomingNextMaxStatusId
        })
      }
    } else {
      updatedSegments.push(currentSegments[i])
    }
  }

  const trimmed = trimSegmentsToMax(updatedSegments, maxStatuses)
  return {
    segments: trimmed,
    statuses: trimmed.flatMap((s) => s.statuses)
  }
}

export const appendOlderPageToSegments = (params: {
  currentSegments: HydratedTimelineSegment[]
  incomingStatuses: Status[]
  incomingNextMaxStatusId: string | null
  maxStatuses?: number
}): {
  segments: HydratedTimelineSegment[]
  statuses: Status[]
} => {
  const {
    currentSegments,
    incomingStatuses,
    incomingNextMaxStatusId,
    maxStatuses = MAX_CACHED_STATUSES_PER_TIMELINE
  } = params

  if (currentSegments.length === 0) {
    const singleSegment: HydratedTimelineSegment = {
      statuses: incomingStatuses,
      nextMaxStatusId: incomingNextMaxStatusId,
      prevMinStatusId: incomingStatuses[0]?.id ?? null
    }
    const trimmed = trimSegmentsToMax([singleSegment], maxStatuses)
    return {
      segments: trimmed,
      statuses: trimmed.flatMap((s) => s.statuses)
    }
  }

  const lastIndex = currentSegments.length - 1
  const lastSeg = currentSegments[lastIndex]

  const existingMap = new Map(lastSeg.statuses.map((s) => [s.id, s]))
  const incomingMap = new Map(incomingStatuses.map((s) => [s.id, s]))

  const updatedExisting = lastSeg.statuses.map((existing) => {
    const incoming = incomingMap.get(existing.id)
    if (incoming) {
      return reconcileStatusesMetadata([incoming], [existing])[0]
    }
    return existing
  })

  const newStatuses: Status[] = []
  for (const st of incomingStatuses) {
    if (!existingMap.has(st.id)) {
      newStatuses.push(st)
    }
  }

  const mergedStatuses = [...updatedExisting, ...newStatuses]

  const updatedLastSeg: HydratedTimelineSegment = {
    statuses: mergedStatuses,
    prevMinStatusId: lastSeg.prevMinStatusId,
    nextMaxStatusId: incomingNextMaxStatusId
  }

  const updatedSegments = [
    ...currentSegments.slice(0, lastIndex),
    updatedLastSeg
  ]

  const trimmed = trimSegmentsToMax(updatedSegments, maxStatuses)
  return {
    segments: trimmed,
    statuses: trimmed.flatMap((s) => s.statuses)
  }
}

export const reconcileSegmentsWithServerBatch = (params: {
  currentSegments: HydratedTimelineSegment[]
  updatedStatuses: Status[]
  removedStatusIds: string[]
}): {
  segments: HydratedTimelineSegment[]
  statuses: Status[]
} => {
  const { currentSegments, updatedStatuses, removedStatusIds } = params

  const removedSet = new Set(removedStatusIds)
  const updatedMap = new Map(updatedStatuses.map((s) => [s.id, s]))

  const updatedSegments: HydratedTimelineSegment[] = []

  for (const seg of currentSegments) {
    const reconciledStatuses: Status[] = []

    for (const item of seg.statuses) {
      if (removedSet.has(item.id)) {
        continue
      }
      if (
        item.type === StatusType.enum.Announce &&
        removedSet.has(item.originalStatus.id)
      ) {
        continue
      }

      let statusToKeep = item
      if (updatedMap.has(item.id)) {
        const incoming = updatedMap.get(item.id)!
        statusToKeep = reconcileStatusesMetadata([incoming], [item])[0]
      } else if (item.type === StatusType.enum.Announce) {
        if (updatedMap.has(item.originalStatus.id)) {
          const incomingOrig = updatedMap.get(item.originalStatus.id)!
          const reconciledOrig = reconcileStatusesMetadata(
            [incomingOrig],
            [item.originalStatus]
          )[0]
          if (reconciledOrig.type !== StatusType.enum.Announce) {
            statusToKeep = {
              ...item,
              originalStatus: reconciledOrig
            }
          }
        }
      }

      reconciledStatuses.push(statusToKeep)
    }

    if (reconciledStatuses.length > 0) {
      updatedSegments.push({
        ...seg,
        statuses: reconciledStatuses
      })
    }
  }

  const finalSegments =
    updatedSegments.length > 0
      ? updatedSegments
      : [{ statuses: [], nextMaxStatusId: null, prevMinStatusId: null }]

  return {
    segments: finalSegments,
    statuses: finalSegments.flatMap((s) => s.statuses)
  }
}
