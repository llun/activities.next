/* eslint-disable camelcase */
import cn from 'classnames'
import formatDistance from 'date-fns/formatDistance'
import { GetServerSideProps, NextPage } from 'next'
import { getServerSession } from 'next-auth/next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import Image from 'next/image'
import Link from 'next/link'

import { Header } from '../../lib/components/Header'
import { Profile as ProfileComponent } from '../../lib/components/Profile'
import { getConfig } from '../../lib/config'
import { Actor, ActorProfile } from '../../lib/models/actor'
import { Session } from '../../lib/models/session'
import { getStorage } from '../../lib/storage'
import { authOptions } from '../api/auth/[...nextauth]'
import styles from '../settings.module.scss'

interface Props {
  profile: ActorProfile
  sessions: Session[]
  currentTime: number
}

const Page: NextPage<Props> = ({ profile, sessions, currentTime }) => {
  const { data: session } = useSession()

  return (
    <main>
      <Head>
        <title>Activities: Settings</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <div className="row">
          <div className="col-12 col-md-3">
            {profile.iconUrl && (
              <Image
                width={100}
                height={100}
                alt="Actor icon"
                className={cn(styles.icon, 'me-4', 'mb-2', 'flex-shrink-0')}
                src={profile.iconUrl}
              />
            )}
            <ProfileComponent
              name={profile.name || ''}
              url={`https://${profile.domain}/${Actor.getMentionFromProfile(
                profile
              )}`}
              username={profile.username}
              domain={profile.domain}
              createdAt={profile.createdAt}
            />
            <ul>
              <li>
                <Link href="/settings" prefetch={false}>
                  Profile
                </Link>
              </li>
              <li>
                <Link href="/settings/sessions" prefetch={false}>
                  Sessions
                </Link>
              </li>
            </ul>
          </div>
          <div className="col-12 col-md-9">
            <h2>Sessions</h2>
            <ul>
              {sessions.map((session) => (
                <li key={`session-${session.expireAt}`}>
                  Session expires in{' '}
                  {formatDistance(session.expireAt, currentTime)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
  res
}) => {
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(req, res, authOptions)
  ])

  const config = getConfig()
  if (
    !session?.user?.email ||
    !config.allowEmails.includes(session?.user?.email || '') ||
    !storage
  ) {
    return {
      redirect: {
        destination: '/auth/signin',
        permanent: false
      }
    }
  }

  const actor = await storage.getActorFromEmail({ email: session.user.email })
  if (!actor || !actor.account) {
    return {
      redirect: {
        destination: '/auth/signin',
        permanent: false
      }
    }
  }

  const sessions = await storage.getAccountAllSessions({
    accountId: actor.account?.id
  })

  return {
    props: {
      profile: actor.toProfile(),
      sessions,
      currentTime: Date.now()
    }
  }
}

export default Page
