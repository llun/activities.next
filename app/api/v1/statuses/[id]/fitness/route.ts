import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getStatusFitnessActivity',
  async (_req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const params = await context.params
    const statusId = decodeURIComponent(params.id)

    const database = getDatabase()
    if (!database) {
      return Response.json({ error: 'Database not available' }, { status: 500 })
    }

    try {
      const activity = await database.getFitnessActivityByStatusId({
        statusId
      })

      if (!activity) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }

      // Return only the relevant fields for display
      return Response.json({
        id: activity.id,
        type: activity.type,
        name: activity.name,
        distance: activity.distance,
        movingTime: activity.movingTime,
        averageSpeed: activity.averageSpeed,
        averageHeartrate: activity.averageHeartrate,
        averageWatts: activity.averageWatts,
        totalElevationGain: activity.totalElevationGain,
        calories: activity.calories
      })
    } catch (error) {
      console.error('Error fetching fitness activity:', error)
      return Response.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
  }
)
