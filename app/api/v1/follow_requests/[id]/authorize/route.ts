import { acceptFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/actions/follow'
import { getDatabase } from '@/lib/database'
import { Scope } from '@/lib/database/types/oauth'
import { FollowStatus } from '@/lib/models/follow'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
    apiErrorResponse,
    apiResponse,
    defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = OAuthGuard<{ id: string }>(
    [Scope.enum.write, Scope.enum.follow],
    async (req, { currentActor, params }) => {
        const database = getDatabase()
        if (!database) {
            return apiErrorResponse(500)
        }

        const { id: accountId } = await params

        // Find the follow request from this account to current actor
        const follow = await database.getAcceptedOrRequestedFollow({
            actorId: accountId,
            targetActorId: currentActor.id
        })

        if (!follow || follow.status !== FollowStatus.enum.Requested) {
            return apiErrorResponse(404)
        }

        // Get the follower actor for sending Accept activity
        const followerActor = await database.getActorFromId({ id: follow.actorId })
        if (!followerActor) {
            return apiErrorResponse(404)
        }

        // Update status to Accepted
        await database.updateFollowStatus({
            followId: follow.id,
            status: FollowStatus.enum.Accepted
        })

        // Send Accept activity
        const followRequest: FollowRequest = {
            id: `https://${followerActor.domain}/${follow.id}`,
            type: 'Follow',
            actor: follow.actorId,
            object: follow.targetActorId
        }
        await acceptFollow(currentActor, followerActor.inboxUrl, followRequest)

        // Return relationship
        const relationship = {
            id: accountId,
            following: false,
            showing_reblogs: true,
            notifying: false,
            languages: [],
            followed_by: true,
            blocking: false,
            blocked_by: false,
            muting: false,
            muting_notifications: false,
            requested: false,
            requested_by: false,
            domain_blocking: false,
            endorsed: false,
            note: ''
        }

        return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: relationship
        })
    }
)
