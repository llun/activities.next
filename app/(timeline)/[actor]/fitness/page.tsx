import { ArrowLeft } from 'lucide-react'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Button } from '@/lib/components/ui/button'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ActorFitnessDashboard } from '../ActorFitnessDashboard'

interface Props {
  params: Promise<{ actor: string }>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { actor } = await params
  return {
    title: `Activities.next: ${decodeURIComponent(actor)} Fitness`
  }
}

const Page: FC<Props> = async ({ params }) => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const session = await getServerSession(getAuthOptions())
  if (!session?.user?.email) {
    return notFound()
  }

  const currentActor = await getActorFromSession(database, session)
  if (!currentActor) {
    return notFound()
  }

  const { actor } = await params
  const decodedActorHandle = decodeURIComponent(actor)
  const parts = decodedActorHandle.split('@').slice(1)
  if (parts.length !== 2) {
    return notFound()
  }
  const [username, actorDomain] = parts

  if (
    currentActor.username !== username ||
    currentActor.domain !== actorDomain
  ) {
    return notFound()
  }

  const hasFitnessData = await database.getActorHasFitnessData({
    actorId: currentActor.id
  })
  if (!hasFitnessData) {
    return notFound()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/@${currentActor.username}@${actorDomain}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Fitness</h1>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <ActorFitnessDashboard actorId={currentActor.id} />
      </div>
    </div>
  )
}

export default Page
