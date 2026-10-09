import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { AuthCard, AuthCardFooter } from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Sign up'
}

const Page: FC = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  // When the server has closed registration there is no sign-up to show; send
  // visitors to the landing, whose auth card explains registration is closed.
  if (!(await getResolvedServerSettings(database)).registrations.open) {
    return redirect('/')
  }

  const session = await getServerAuthSession()
  if (session && session.user) {
    return redirect('/')
  }

  return (
    <AuthCard
      logoSrc={getAuthLogoSrc()}
      title="Create an account"
      description="Join Activities and start sharing"
      footer={
        <AuthCardFooter>
          Already have an account?{' '}
          <Link
            href="/auth/signin"
            className="text-primary-text hover:underline"
          >
            Sign in
          </Link>
        </AuthCardFooter>
      }
    >
      <form method="post" action="/api/v1/accounts" className="space-y-4">
        <Frame divided>
          <FormRow stacked label="Username" htmlFor="inputUsername">
            <Input name="username" type="text" id="inputUsername" />
          </FormRow>
          <FormRow stacked label="Full name" htmlFor="inputName">
            <Input
              name="name"
              type="text"
              id="inputName"
              placeholder="Your display name"
            />
          </FormRow>
          <FormRow stacked label="Email" htmlFor="inputEmail">
            <Input name="email" type="email" id="inputEmail" />
          </FormRow>
          <FormRow stacked label="Password" htmlFor="inputPassword">
            <Input name="password" type="password" id="inputPassword" />
          </FormRow>
        </Frame>

        <Button type="submit" className="w-full">
          Sign up
        </Button>
      </form>
    </AuthCard>
  )
}

export default Page
