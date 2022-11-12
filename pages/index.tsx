import { GetServerSideProps, NextPage } from 'next'
import parse from 'html-react-parser'
import { useSession, signIn, signOut } from 'next-auth/react'

import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'

interface Props {
  statuses: Status[]
}

const Page: NextPage<Props> = ({ statuses }) => {
  const { data: session } = useSession()
  if (session) {
    return (
      <>
        Signed in as {session.user?.email} <br />
        <button onClick={() => signOut()}>Sign out</button>
      </>
    )
  }
  return (
    <>
      Not signed in <br />
      <button onClick={() => signIn()}>Sign in</button>
    </>
  )

  return (
    <div className="prose container mx-auto">
      <section className="w-full py-4 grid grid-cols-1 gap-6">
        <label className="block">
          <span className="text-gray-700">Message</span>
          <textarea className="mt-1 block w-full" rows={3}></textarea>
        </label>
        <div className="block">
          <button>Send</button>
        </div>
      </section>
      <section className="w-full grid grid-cols-1">
        {statuses.map((status) => (
          <div key={status.uri} className="block">
            {parse(status.text)}
          </div>
        ))}
      </section>
    </div>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  const storage = await getStorage()
  if (!storage) return { notFound: true }

  const statuses = await storage.getStatuses()
  return {
    props: {
      statuses
    }
  }
}

export default Page
