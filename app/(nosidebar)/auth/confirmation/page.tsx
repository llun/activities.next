import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getStorage } from '@/lib/storage'
import { Storage } from '@/lib/storage/types'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Confirm account'
}

const isVerify = async (storage: Storage, verificationCode?: string) => {
  if (!verificationCode) return false
  return storage.verifyAccount({ verificationCode })
}

interface Props {
  searchParams: Record<string, string | string[] | undefined>
}
const Page: FC<Props> = async ({ searchParams }) => {
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(getAuthOptions())
  ])

  if (!storage) throw new Error('Storage is not available')
  if (session && session.user) {
    return redirect('/')
  }

  const verificationCode = Array.isArray(searchParams.verificationCode)
    ? searchParams.verificationCode[0]
    : searchParams.verificationCode
  const isAccountVerify = Boolean(await isVerify(storage, verificationCode))

  return (
    <h1>
      {isAccountVerify
        ? 'Your account is verified'
        : 'Invalid verification code'}
    </h1>
  )
}

export default Page
