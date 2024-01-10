import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Button } from '@/lib/components/Button'
import { getStorage } from '@/lib/storage'

const Page: FC = async () => {
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(authOptions)
  ])

  if (!storage) throw new Error('Storage is not available')
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
