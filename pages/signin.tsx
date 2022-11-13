import { GetServerSideProps, NextPage } from 'next'
import { getCsrfToken } from 'next-auth/react'
import { unstable_getServerSession } from 'next-auth/next'
import { authOptions } from './api/auth/[...nextauth]'

import { getConfig } from '../lib/config'
import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'

interface Props {
  csrfToken?: string
  host: string
}

const Page: NextPage<Props> = ({ csrfToken, host }) => {
  return (
    <main>
      <Header />
      <section className="container pt-4">
        <form action={`https://${host}/api/auth/signin/github`} method="POST">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="callbackUrl" value={`https://${host}`} />
          <Button type="submit">Sign in with Github</Button>
        </form>
      </section>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
  res
}) => {
  const session = await unstable_getServerSession(req, res, authOptions)
  if (session?.user) {
    return {
      redirect: {
        destination: '/',
        permanent: false
      }
    }
  }

  const config = getConfig()
  const csrfToken = await getCsrfToken({ req })
  return {
    props: {
      csrfToken,
      host: config.host
    }
  }
}

export default Page
