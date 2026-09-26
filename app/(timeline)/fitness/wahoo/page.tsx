import { redirect } from 'next/navigation'
import { FC } from 'react'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const WahooPage: FC<Props> = async ({ searchParams }) => {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      query.set(key, value)
    } else if (Array.isArray(value)) {
      for (const v of value) query.append(key, v)
    }
  }
  const queryString = query.toString()
  redirect(`/fitness/connections/wahoo${queryString ? `?${queryString}` : ''}`)
}

export default WahooPage
