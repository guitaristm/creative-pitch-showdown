// Generate voting tokens for HR distribution.
//   node scripts/generateTokens.ts [count]      (default 20)
// Writes to ./tokens-output/ (gitignored):
//   distribute.csv  — token_label,raw_token   → give each employee ONE row, keep the rest private
//   insert.sql      — SELECT add_token(...) statements to paste into the Supabase SQL editor
// The DB stores only the hash; raw tokens live only in distribute.csv. Never commit that file.
import { createHash, randomInt } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

const N = Number(process.argv[2] || 20)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I ambiguity
const block = () => Array.from({ length: 4 }, () => CHARS[randomInt(CHARS.length)]).join('')
const normalize = (t: string) => t.replace(/\s+/g, '').toUpperCase()
const hash = (t: string) => createHash('sha256').update(normalize(t)).digest('hex')

const rows = Array.from({ length: N }, (_, i) => {
  const raw = `EMP-${block()}-${block()}`
  return { label: `EMP-${String(i + 1).padStart(3, '0')}`, raw, hash: hash(raw) }
})

mkdirSync('tokens-output', { recursive: true })
writeFileSync('tokens-output/distribute.csv', 'token_label,raw_token\n' + rows.map((r) => `${r.label},${r.raw}`).join('\n') + '\n')
writeFileSync('tokens-output/insert.sql', rows.map((r) => `select add_token('${r.raw}', '${r.label}');`).join('\n') + '\n')

console.log(`Generated ${N} tokens → tokens-output/distribute.csv (raw, for HR) and insert.sql (run in Supabase).`)
console.log('Do NOT commit tokens-output/. Raw tokens are the only way to vote.')
