import { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import parse from 'html-react-parser'
import { signOut, useSession } from 'next-auth/react'
import { unstable_getServerSession } from 'next-auth/next'
import { authOptions } from './api/auth/[...nextauth]'

import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { getConfig } from '../lib/config'

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
        <section className="w-full py-4 grid grid-cols-1 gap-6">
          <label className="block">
            <span className="text-gray-700">Message</span>
            <textarea className="mt-1 block w-full" rows={3}></textarea>
          </label>
          <div className="block">
            <Button>Send</Button>
          </div>
        </section>
        <section className="w-full grid grid-cols-1">
          {statuses.map((status) => (
            <div key={status.uri} className="block">
              {parse(status.text)}
            </div>
          ))}
        </section>
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
