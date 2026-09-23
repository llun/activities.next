import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

const Page = () => {
  redirect('/fitness/wahoo')
}

export default Page
