import { redirect } from 'next/navigation'

// The timeline layout reads the config and database, so this is never
// prerendered.
export const dynamic = 'force-dynamic'

// Featured hashtags live in the Edit profile page now.
const Page = () => redirect('/settings/profile#featured-hashtags')

export default Page
