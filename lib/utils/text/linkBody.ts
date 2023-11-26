const LINK_BODY_LIMIT = 25

export const linkBody = (url: string) => {
  let link
  try {
    link = new URL(url)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'ERR_INVALID_URL') {
      throw nodeError
    }
    link = new URL(`https://${url}`)
  }

  const hostname = link.host.startsWith('www.') ? link.host.slice(4) : link.host
  const pathnameWithSearch = `${link.pathname}${link.search}`
  const pathname =
    pathnameWithSearch.length > LINK_BODY_LIMIT
      ? `${pathnameWithSearch.slice(0, LINK_BODY_LIMIT)}…`
      : pathnameWithSearch
  return `<a href="${link.toString()}" target="_blank" rel="nofollow noopener noreferrer">${hostname}${
    pathname === '/' ? '' : pathname
  }</a>`
}
