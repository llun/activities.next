import { Mastodon } from '@llun/activities.schema'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Pagination } from '@/lib/components/pagination/Pagination'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { FollowRequestsList } from './FollowRequestsList'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Activities.next: Follow Requests'
}

const ITEMS_PER_PAGE = 20

interface Props {
    searchParams: Promise<{ page?: string }>
}

const Page = async ({ searchParams }: Props) => {
    const database = getDatabase()
    if (!database) {
        throw new Error('Fail to load database')
    }

    const session = await getServerSession(getAuthOptions())
    const actor = await getActorFromSession(database, session)
    if (!actor) {
        return redirect('/auth/signin')
    }

    const params = await searchParams
    const currentPage = parseInt(params.page || '1', 10)
    const offset = (currentPage - 1) * ITEMS_PER_PAGE

    const [followRequests, totalCount] = await Promise.all([
        database.getFollowRequests({
            targetActorId: actor.id,
            limit: ITEMS_PER_PAGE,
            offset
        }),
        database.getFollowRequestsCount({ targetActorId: actor.id })
    ])

    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE)

    // Get Mastodon accounts for each follow request
    const accounts = (
        await Promise.all(
            followRequests.map(async (follow) => {
                return database.getMastodonActorFromId({ id: follow.actorId })
            })
        )
    ).filter(Boolean) as Mastodon.Account[]

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Follow Requests</h1>
                <p className="text-sm text-muted-foreground">
                    People who want to follow you
                </p>
            </div>

            {accounts.length === 0 ? (
                <div className="rounded-xl border bg-background/80 p-8 text-center text-muted-foreground">
                    No pending follow requests
                </div>
            ) : (
                <>
                    <FollowRequestsList accounts={accounts} />

                    {totalPages > 1 && (
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            basePath="/notifications"
                        />
                    )}
                </>
            )}
        </div>
    )
}

export default Page
