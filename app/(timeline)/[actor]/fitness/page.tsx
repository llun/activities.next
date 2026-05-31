import { redirect } from 'next/navigation'

// The actor-scoped fitness dashboard moved to the top-level `/fitness` section.
// Keep this stub so existing links/bookmarks to `/:actor/fitness` still resolve.
export const dynamic = 'force-dynamic'

const Page = () => {
  redirect('/fitness')
}

export default Page
