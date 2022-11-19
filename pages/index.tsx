import { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import parse from 'html-react-parser'
import { useSession } from 'next-auth/react'
import { unstable_getServerSession } from 'next-auth/next'
import cn from 'classnames'
import { formatDistanceToNow } from 'date-fns'

import { authOptions } from './api/auth/[...nextauth]'

import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { getConfig } from '../lib/config'
import { getHostnameFromId, getUsernameFromId } from '../lib/models/actor'

interface Props {
  statuses: Status[]
}

const Page: NextPage<Props> = ({ statuses }) => {
  const { data: session } = useSession()
  return (
    <main>
      <Head>
        <title>Activities: timeline</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <form action="/api/v1/accounts/outbox" method="post">
          <div className="mb-3">
            <textarea className="form-control" rows={3} name="message" />
          </div>
          <Button type="submit">Send</Button>
        </form>
        {statuses.length > 0 && (
          <section className="w-full grid grid-cols-1 mt-4">
            {statuses.map((status) => (
              <div key={status.id} className="block">
                <div>
                  <strong>
                    @{getUsernameFromId(status.actorId)}@
                    {getHostnameFromId(status.actorId)}
                  </strong>
                </div>
                <div className={cn('d-flex')}>
                  <div className="flex-fill me-1">
                    {parse(status.text, {
                      replace: (domNode: any) => {
                        if (domNode.attribs && domNode.name === 'a') {
                          domNode.attribs.target = '_blank'
                          return domNode
                        }

                        return domNode
                      }
                    })}
                  </div>
                  <div className="flex-shrink-0">
                    {formatDistanceToNow(status.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}
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

  const isAccountExists = await storage.isAccountExists(session?.user?.email)
  if (!isAccountExists) {
    return {
      redirect: {
        destination: '/setup',
        permanent: false
      }
    }
  }

  const statuses = await storage.getStatuses()
  return {
    props: {
      statuses
    }
  }
}

export default Page
