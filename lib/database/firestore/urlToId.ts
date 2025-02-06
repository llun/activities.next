export const urlToId = (idInURLFormat: string) => {
  const url = new URL(idInURLFormat)
  return `${url.host}:${url.pathname.slice(1).replaceAll('/', ':')}`
}
