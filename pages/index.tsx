import { GetServerSideProps, NextPage } from 'next'
import parse from 'html-react-parser'
import { useSession, signIn, signOut, getCsrfToken } from 'next-auth/react'
import { unstable_getServerSession } from 'next-auth/next'
import { authOptions } from './api/auth/[...nextauth]'

import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import { getConfig } from '../lib/config'
import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'

interface Props {
  isAccountExists: boolean
  statuses: Status[]
  csrfToken?: string
  host: string
}

const Page: NextPage<Props> = ({
  statuses,
  isAccountExists,
  csrfToken,
  host
}) => {
  const { data: session } = useSession()

  return (
    <main>
      <Header />
      <section className="container pt-4">
        {session && (
          <>
            <Button onClick={() => signOut()}>Sign out</Button>

            {!isAccountExists && <section>Enter your handle name</section>}
            {isAccountExists && (
              <>
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
              </>
            )}
          </>
        )}
        {!session && (
          <form action={`https://${host}/api/auth/signin/github`} method="POST">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="callbackUrl" value={`https://${host}`} />
            <Button type="submit">Sign in with Github</Button>
          </form>
        )}
      </section>
    </main>
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
  const csrfToken = await getCsrfToken({ req })
  const host = getConfig().host

  return {
    props: {
      statuses,
      isAccountExists,
      csrfToken,
      host
    }
  }
}

export default Page
