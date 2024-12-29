import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { auth } from '@/auth'
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
  searchParams: Promise<Record<string, string | string[] | undefined>>
}
const Page: FC<Props> = async ({ searchParams }) => {
  const [storage, session] = await Promise.all([getStorage(), auth()])

  if (!storage) throw new Error('Storage is not available')
  if (session && session.user) {
    return redirect('/')
  }

  const { verificationCode } = await searchParams
  const code = Array.isArray(verificationCode)
    ? verificationCode[0]
    : verificationCode
  const isAccountVerify = Boolean(await isVerify(storage, code))

  return (
    <h1>
      {isAccountVerify
        ? 'Your account is verified'
        : 'Invalid verification code'}
    </h1>
  )
}

export default Page
