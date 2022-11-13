import { GetServerSideProps, NextPage } from 'next'
import { unstable_getServerSession } from 'next-auth/next'
import { authOptions } from './api/auth/[...nextauth]'

import { Header } from '../lib/components/Header'

interface Props {}

const Page: NextPage<Props> = () => {
  return (
    <main>
      <Header />
      <section className="container pt-4">Setup your handle here</section>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
  res
}) => {
  const session = await unstable_getServerSession(req, res, authOptions)
  if (!session?.user) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  return {
    props: {}
  }
}

export default Page
