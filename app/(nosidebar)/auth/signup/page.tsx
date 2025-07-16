import { Metadata } from 'next'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { Button } from '@/lib/components/Button'
import { getDatabase } from '@/lib/database'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Sign up'
}

const Page: FC = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const session = await auth()
  if (session && session.user) {
    return redirect('/')
  }

  return (
    <form method="post" action="/api/v1/accounts">
      <div className="mb-2">
        <div className="mb-3 row">
          <label htmlFor="inputUsername" className="col-sm-2 col-form-label">
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
          <label htmlFor="inputPassword" className="col-sm-2 col-form-label">
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

        <Button type="submit">Sign up</Button>
      </div>
    </form>
  )
}

export default Page
