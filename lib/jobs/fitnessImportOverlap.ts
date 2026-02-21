export interface FitnessOverlapActivity {
  id: string
  startTimeMs: number
  durationSeconds: number
}

const getOverlapRatio = (
  first: FitnessOverlapActivity,
  second: FitnessOverlapActivity
) => {
  const firstDurationMs = Math.max(0, first.durationSeconds) * 1000
  const secondDurationMs = Math.max(0, second.durationSeconds) * 1000

  if (firstDurationMs <= 0 || secondDurationMs <= 0) {
    return 0
  }

  const firstEnd = first.startTimeMs + firstDurationMs
  const secondEnd = second.startTimeMs + secondDurationMs
  const overlapStart = Math.max(first.startTimeMs, second.startTimeMs)
  const overlapEnd = Math.min(firstEnd, secondEnd)
  const overlapDuration = Math.max(0, overlapEnd - overlapStart)

  if (overlapDuration <= 0) {
    return 0
  }

  const shortestDuration = Math.min(firstDurationMs, secondDurationMs)
  return overlapDuration / shortestDuration
}

class UnionFind {
  private readonly parent: number[]
  private readonly rank: number[]

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index)
    this.rank = Array.from({ length: size }, () => 0)
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index])
    }

    return this.parent[index]
  }

  union(first: number, second: number): void {
    const firstRoot = this.find(first)
    const secondRoot = this.find(second)

    if (firstRoot === secondRoot) return

    if (this.rank[firstRoot] < this.rank[secondRoot]) {
      this.parent[firstRoot] = secondRoot
      return
    }

    if (this.rank[firstRoot] > this.rank[secondRoot]) {
      this.parent[secondRoot] = firstRoot
      return
    }

    this.parent[secondRoot] = firstRoot
    this.rank[firstRoot] += 1
  }
}

export const groupFitnessActivitiesByOverlap = (
  activities: FitnessOverlapActivity[],
  threshold = 0.8
): FitnessOverlapActivity[][] => {
  if (activities.length === 0) {
    return []
  }

  const unionFind = new UnionFind(activities.length)

  for (let firstIndex = 0; firstIndex < activities.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < activities.length;
      secondIndex += 1
    ) {
      const ratio = getOverlapRatio(
        activities[firstIndex],
        activities[secondIndex]
      )
      if (ratio >= threshold) {
        unionFind.union(firstIndex, secondIndex)
      }
    }
  }

  const groupedByRoot = new Map<number, FitnessOverlapActivity[]>()
  activities.forEach((activity, index) => {
    const root = unionFind.find(index)
    const existing = groupedByRoot.get(root) ?? []
    existing.push(activity)
    groupedByRoot.set(root, existing)
  })

  return [...groupedByRoot.values()]
    .map((group) =>
      group.sort((first, second) => {
        if (first.startTimeMs === second.startTimeMs) {
          return first.id.localeCompare(second.id)
        }
        return first.startTimeMs - second.startTimeMs
      })
    )
    .sort((first, second) => {
      const firstStart = first[0]?.startTimeMs ?? Number.MAX_SAFE_INTEGER
      const secondStart = second[0]?.startTimeMs ?? Number.MAX_SAFE_INTEGER
      return firstStart - secondStart
    })
}
