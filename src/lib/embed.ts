/** Convert a shared presentation link into an embeddable URL (Google Slides, Canva; others pass through). */
export function toEmbedUrl(url: string): string {
  const gslides = url.match(/(https:\/\/docs\.google\.com\/presentation\/d\/[\w-]+)/)
  if (gslides) return `${gslides[1]}/embed?start=false&loop=false&rm=minimal`
  const canva = url.match(/(https:\/\/www\.canva\.com\/design\/[\w-]+\/[\w-]+)/)
  if (canva) return `${canva[1]}/view?embed`
  return url
}
