import { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import { useSession } from 'next-auth/react'
import { unstable_getServerSession } from 'next-auth/next'

import { authOptions } from './api/auth/[...nextauth]'

import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { getConfig } from '../lib/config'
import { Posts } from '../lib/components/Posts/Posts'
import {
  Actor,
  getHostnameFromId,
  getUsernameFromId
} from '../lib/models/actor'
import styles from './index.module.scss'
import Link from 'next/link'

interface Props {
  statuses: Status[]
  actor: Actor
}

const Page: NextPage<Props> = ({ actor, statuses }) => {
  const { data: session } = useSession()

  return (
    <main>
      <Head>
        <title>Activities: timeline</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <div className="row">
          <div className="col-12 col-md-3">
            {actor.iconUrl && (
              <img
                alt="Actor icon"
                className={cn(styles.icon, 'me-4', 'mb-2', 'flex-shrink-0')}
                src={actor.iconUrl}
              />
            )}
            <h1>{actor.name}</h1>
            <h4>@{getUsernameFromId(actor.id)}</h4>
            {Number.isInteger(actor.createdAt) && (
              <p>
                Joined{' '}
                {new Intl.DateTimeFormat('en-US', {
                  dateStyle: 'long',
                  timeStyle: 'short'
                }).format(new Date(actor.createdAt))}
              </p>
            )}
          </div>
          <div className="col-12 col-md-9">
            <form action="/api/v1/accounts/outbox" method="post">
              <div className="mb-3">
                <textarea className="form-control" rows={3} name="message" />
              </div>
              <Button type="submit">Send</Button>
            </form>
            <Posts statuses={statuses} showActorId showActions />
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
    unstable_getServerSession(req, res, authOptions)
  ])

  const config = getConfig()
  if (
    !session?.user?.email ||
    !config.allowEmails.includes(session?.user?.email || '') ||
    !storage
  ) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  const isAccountExists = await storage.isAccountExists({
    email: session?.user?.email
  })
  if (!isAccountExists) {
    return {
      redirect: {
        destination: '/setup',
        permanent: false
      }
    }
  }

  const [statuses, actor] = await Promise.all([
    storage.getStatuses(),
    storage.getActorFromEmail({ email: session.user.email })
  ])
  if (!actor) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  return {
    props: {
      statuses,
      actor
    }
  }
}

export default Page
