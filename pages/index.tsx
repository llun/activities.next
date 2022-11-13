import { GetServerSideProps, NextPage } from 'next'
import parse from 'html-react-parser'
import { signOut } from 'next-auth/react'
import { unstable_getServerSession } from 'next-auth/next'
import { authOptions } from './api/auth/[...nextauth]'

import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'

interface Props {
  statuses: Status[]
}

const Page: NextPage<Props> = ({ statuses }) => {
  return (
    <main>
      <Header />
      <section className="container pt-4">
        <Button onClick={() => signOut()}>Sign out</Button>

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

  if (!storage) {
    return { notFound: true }
  }

  if (!session?.user?.email) {
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
