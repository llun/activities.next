import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function FitnessPage() {
  redirect('/settings/fitness/general')
}
