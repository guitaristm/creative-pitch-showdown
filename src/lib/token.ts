/** Normalize a voting token identically to SQL norm_token(): strip all whitespace, uppercase. */
export function normalizeToken(t: string): string {
  return t.replace(/\s+/g, '').toUpperCase()
}

/** SHA-256 hex of the normalized token — must equal SQL hash_token(). Used by the token script. */
export async function hashToken(t: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeToken(t))
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
