export type DiffSegment = { type: 'same' | 'add' | 'del'; value: string }

/**
 * Word-level LCS diff. Keeps whitespace as tokens so segments can be
 * concatenated back into the original strings. Ingredient lists are short,
 * so an O(n*m) table is fine; fall back to a coarse diff when huge.
 */
export function wordDiff(oldText: string, newText: string): DiffSegment[] {
  const a = oldText.split(/(\s+)/).filter((t) => t !== '')
  const b = newText.split(/(\s+)/).filter((t) => t !== '')
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []
  if (n * m > 400_000) {
    return [
      { type: 'del', value: oldText },
      { type: 'add', value: newText },
    ]
  }

  const W = m + 1
  const dp = new Uint32Array((n + 1) * W)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1])
    }
  }

  const raw: DiffSegment[] = []
  const push = (type: DiffSegment['type'], value: string) => {
    const last = raw[raw.length - 1]
    if (last && last.type === type) last.value += value
    else raw.push({ type, value })
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) {
      push('del', a[i])
      i++
    } else {
      push('add', b[j])
      j++
    }
  }
  while (i < n) push('del', a[i++])
  while (j < m) push('add', b[j++])
  return raw
}

/** Short label fields diff as one atomic segment. */
export function fieldDiff(oldValue: string, newValue: string): DiffSegment[] {
  if (oldValue === newValue) return [{ type: 'same', value: oldValue }]
  return [
    { type: 'del', value: oldValue },
    { type: 'add', value: newValue },
  ]
}
