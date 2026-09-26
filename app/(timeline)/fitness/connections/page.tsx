import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function ConnectionsPage() {
  redirect('/fitness/connections/strava')
}
