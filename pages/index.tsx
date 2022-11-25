/* eslint-disable camelcase */
import cn from 'classnames'
import { GetServerSideProps, NextPage } from 'next'
import { unstable_getServerSession } from 'next-auth/next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import Image from 'next/image'
import { FormEvent, useRef, useState } from 'react'

import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { Posts } from '../lib/components/Posts/Posts'
import { ReplyPreview } from '../lib/components/ReplyPreview'
import { getConfig } from '../lib/config'
import {
  Actor,
  getAtWithHostFromId,
  getUsernameFromId
} from '../lib/models/actor'
import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import { authOptions } from './api/auth/[...nextauth]'
import styles from './index.module.scss'

interface Props {
  statuses: Status[]
  actor: Actor
}

const Page: NextPage<Props> = ({ actor, statuses }) => {
  const { data: session } = useSession()
  const [replyStatus, setReplyStatus] = useState<Status>()
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const postBoxRef = useRef<HTMLTextAreaElement>(null)

  const onReply = (status: Status) => {
    setReplyStatus(status)
    window.scrollTo({ top: 0 })

    if (!postBoxRef.current) return
    const postBox = postBoxRef.current

    const replyText = `${getAtWithHostFromId(status.actorId)} `
    postBox.value = replyText
    postBox.selectionStart = replyText.length
    postBox.selectionEnd = replyText.length
    postBox.focus()
  }

  const onCloseReply = () => {
    setReplyStatus(undefined)

    if (!postBoxRef.current) return
    const postBox = postBoxRef.current
    postBox.value = ''
  }

  const onPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!postBoxRef.current) return

    const message = postBoxRef.current.value
    const response = await fetch('/api/v1/accounts/outbox', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        replyStatus,
        message
      })
    })
    if (response.status !== 200) {
      // Handle error here
      return
    }

    const json = await response.json()
    setCurrentStatuses((previousValue) => [json.status, ...previousValue])
    setReplyStatus(undefined)
    postBoxRef.current.value = ''
  }

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
              <Image
                width={100}
                height={100}
                alt="Actor icon"
                className={cn(styles.icon, 'me-4', 'mb-2', 'flex-shrink-0')}
                src={actor.iconUrl}
              />
            )}
            <div>
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
          </div>
          <div className="col-12 col-md-9">
            <ReplyPreview status={replyStatus} onClose={onCloseReply} />
            <form onSubmit={onPost}>
              <div className="mb-3">
                <textarea
                  ref={postBoxRef}
                  className="form-control"
                  rows={3}
                  name="message"
                />
              </div>
              <Button type="submit">Send</Button>
            </form>
            <Posts
              statuses={currentStatuses}
              showActorId
              showActions
              onReply={onReply}
            />
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
