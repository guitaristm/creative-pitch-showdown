/** Convert a shared presentation link into an embeddable URL (Google Slides, Canva; others pass through). */
export function toEmbedUrl(url: string): string {
  // handles both normal (/d/<id>/edit) and published-to-web (/d/e/<id>/pub) links
  const gslides = url.match(/(https:\/\/docs\.google\.com\/presentation\/d\/(?:e\/)?[\w-]+)/)
  if (gslides) return `${gslides[1]}/embed?start=false&loop=false&delayms=60000`
  const canva = url.match(/(https:\/\/www\.canva\.com\/design\/[\w-]+\/[\w-]+)/)
  if (canva) return `${canva[1]}/view?embed`
  return url
}

/**
 * Convert a video share link into an embeddable player URL.
 * Drive videos use the /preview player — Google allows framing it on third-party
 * sites, unlike videos inside an embedded Slides deck. YouTube → /embed. mp4 etc. pass through.
 */
export function toVideoEmbedUrl(url: string): string {
  const drive = url.match(/https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/)
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  return url
}
