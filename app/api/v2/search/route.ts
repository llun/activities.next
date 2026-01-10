import { NextResponse } from 'next/server'

export const GET = async () => {
  return NextResponse.json(
    {
      accounts: [],
      statuses: [],
      hashtags: []
    },
    { status: 200 }
  )
}
