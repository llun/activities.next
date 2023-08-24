import type {
  GetServerSidePropsContext,
  InferGetServerSidePropsType
} from 'next'
import Head from 'next/head'

import { Header } from '../../lib/components/Header'
import { getStorage } from '../../lib/storage'

export default function Confirmation({
  verify
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <main>
      <Head>
        <title>Activities: confirm account</title>
      </Head>
      <Header />
      <section className="container pt-4">
        <div className="col-12">
          <h1>
            {verify ? 'Your account is verified' : 'Invalid verification code'}
          </h1>
        </div>
      </section>
    </main>
  )
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const { query } = context
  const { verificationCode } = query
  if (!verificationCode) {
    return {
      props: {
        verify: false
      }
    }
  }

  const storage = await getStorage()
  if (!storage) {
    return { props: { verify: false } }
  }

  const account = await storage.verifyAccount({
    verificationCode: Array.isArray(verificationCode)
      ? verificationCode[0]
      : verificationCode
  })
  return {
    props: { verify: Boolean(account) }
  }
}
