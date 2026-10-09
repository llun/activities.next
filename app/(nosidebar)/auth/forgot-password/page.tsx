import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { AuthCard, AuthCardFooter } from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'

import { RequestPasswordResetForm } from './RequestPasswordResetForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Forgot Password'
}

const Page: FC = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const session = await getServerAuthSession()
  if (session && session.user) {
    return redirect('/')
  }

  return (
    <AuthCard
      logoSrc={getAuthLogoSrc()}
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to reset it."
      footer={
        <AuthCardFooter>
          Remembered your password?{' '}
          <Link
            href="/auth/signin"
            className="text-primary-text hover:underline"
          >
            Sign in
          </Link>
        </AuthCardFooter>
      }
    >
      <RequestPasswordResetForm />
    </AuthCard>
  )
}

export default Page
