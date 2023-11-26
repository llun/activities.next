export const mentionBody = (url: string, username: string) =>
  `<span class="h-card"><a href="${url}" target="_blank" class="u-url mention">@<span>${username}</span></a></span>`
