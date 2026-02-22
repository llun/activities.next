import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageSearchParams = {
  page?: string
  limit?: string
}

const Page = async ({
  searchParams
}: {
  searchParams: PageSearchParams | Promise<PageSearchParams>
}) => {
  const params = await Promise.resolve(searchParams)
  const query = new URLSearchParams()

  if (params.page) {
    query.set('page', params.page)
  }

  if (params.limit) {
    query.set('limit', params.limit)
  }

  const suffix = query.toString()
  redirect(`/settings/fitness/general${suffix ? `?${suffix}` : ''}`)
}

export default Page
