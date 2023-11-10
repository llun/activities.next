import type { GetServerSidePropsContext } from 'next'
import { getServerSession } from 'next-auth/next'
import Head from 'next/head'

import { authOptions } from '../../app/api/auth/[...nextauth]/authOptions'
import { Button } from '../../lib/components/Button'
import { Header } from '../../lib/components/Header'

export default function Register() {
  return (
    <main>
      <Head>
        <title>Activities: register</title>
      </Head>
      <Header />
      <section className="container pt-4">
        <div className="col-12">
          <form method="post" action="/api/v1/accounts">
            <div className="mb-2">
              <div className="mb-3 row">
                <label
                  htmlFor="inputUsername"
                  className="col-sm-2 col-form-label"
                >
                  Username
                </label>
                <div className="col-sm-10">
                  <input
                    name="username"
                    type="text"
                    className="form-control"
                    id="inputUsername"
                  />
                </div>
              </div>
              <div className="mb-3 row">
                <label htmlFor="inputEmail" className="col-sm-2 col-form-label">
                  Email
                </label>
                <div className="col-sm-10">
                  <input
                    name="email"
                    type="text"
                    className="form-control"
                    id="inputEmail"
                  />
                </div>
              </div>
              <div className="mb-3 row">
                <label
                  htmlFor="inputPassword"
                  className="col-sm-2 col-form-label"
                >
                  Password
                </label>
                <div className="col-sm-10">
                  <input
                    name="password"
                    type="password"
                    className="form-control"
                    id="inputPassword"
                  />
                </div>
              </div>

              <Button type="submit">Register</Button>
            </div>
          </form>
        </div>
      </section>
    </main>
  )
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const session = await getServerSession(context.req, context.res, authOptions)
  if (session) {
    return { redirect: { destination: '/' } }
  }
  return {
    props: {}
  }
}
