import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { Section } from '@/lib/components/surface/Section'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getBlueskyAccountState } from '@/lib/services/bluesky/account'
import { getBlueskySharingState } from '@/lib/services/blueskySharing'
import { getHostedBlueskyAccountState } from '@/lib/services/pds/accounts'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { BlueskyAccountForm } from './BlueskyAccountForm'
import { BlueskySharingForm } from './BlueskySharingForm'
import { HostedBlueskyForm } from './HostedBlueskyForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Other networks' }

const Page = async ({
  searchParams
}: {
  searchParams?: Promise<{ bluesky?: string | string[] }>
} = {}) => {
  const database = getDatabase()
  if (!database) throw new Error('Fail to load database')
  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor?.account) return redirect('/auth/signin')
  const callbackResult = (await searchParams)?.bluesky

  const [accountState, sharingState, hostedState] = await Promise.all([
    getBlueskyAccountState(database, actor),
    getBlueskySharingState(database, actor),
    getHostedBlueskyAccountState({ database, actor })
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bluesky"
        description="Link your Bluesky account, or share this profile’s public posts through Bridgy Fed."
      />
      <Section
        title="Your Bluesky account"
        description="An account on bsky.social or any other Bluesky server."
      >
        <BlueskyAccountForm
          key={actor.id}
          initialState={accountState}
          callbackResult={
            typeof callbackResult === 'string' ? callbackResult : null
          }
        />
      </Section>
      {/* A profile the server no longer offers accounts to still sees the
          one it has, to turn it off or delete it. */}
      {hostedState.available || hostedState.repo ? (
        <Section
          title="Host my Bluesky account here"
          description={
            hostedState.available
              ? `Create a Bluesky account on this server. Your posts reach Bluesky through ${hostedState.pdsHostname}.`
              : 'Your Bluesky account on this server.'
          }
        >
          <HostedBlueskyForm
            key={actor.id}
            initialState={hostedState}
            linked={accountState.account !== null}
          />
        </Section>
      ) : null}
      <Section
        title="Share through Bridgy Fed"
        description="Copies this profile’s public posts to a bridged Bluesky account."
      >
        <BlueskySharingForm key={actor.id} initialState={sharingState} />
      </Section>
    </div>
  )
}

export default Page
