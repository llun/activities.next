import { GetServerSideProps, NextPage } from 'next'
import parse from 'html-react-parser'
import { useSession, signIn, signOut } from 'next-auth/react'
import { unstable_getServerSession } from 'next-auth/next'
import { authOptions } from './api/auth/[...nextauth]'

import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'

interface Props {
  isAccountExists: boolean
  statuses: Status[]
}

const Page: NextPage<Props> = ({ statuses, isAccountExists }) => {
  const { data: session } = useSession()
  if (session) {
    return (
      <div className="prose container mx-auto">
        <button onClick={() => signOut()}>Sign out</button>

        {!isAccountExists && <section>Enter your handle name</section>}
        {isAccountExists && (
          <>
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
          </>
        )}
      </div>
    )
  }
  return (
    <div className="prose container mx-auto">
      Not signed in <br />
      <button onClick={() => signIn()}>Sign in</button>
    </div>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
  res
}) => {
  const storage = await getStorage()
  if (!storage) return { notFound: true }

  const session = await unstable_getServerSession(req, res, authOptions)
  const isAccountExists = await storage.isAccountExists(session?.user?.email)
  const statuses = await storage.getStatuses()
  return {
    props: {
      statuses,
      isAccountExists
    }
  }
}

export default Page
