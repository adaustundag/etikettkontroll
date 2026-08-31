import { existsSync } from 'fs'
import path from 'path'

/**
 * Where uploaded photos live, by priority:
 * 1. $UPLOADS_DIR          — explicit override (deployments)
 * 2. /data/uploads         — persistent volume auto-detect (Railway mounts /data)
 * 3. <cwd>/public/uploads  — dev / preview (Next serves public/ natively)
 * 4. standalone public     — standalone prod build without a volume
 * 5. <cwd>/public/uploads  — fallback (created on demand)
 *
 * On a volume, photos must be served through GET /uploads/[file] because the
 * static public/ folder is ephemeral between deploys.
 */
export function uploadsDir(): string {
  if (process.env.UPLOADS_DIR) return process.env.UPLOADS_DIR
  if (existsSync('/data')) return '/data/uploads'
  const cwd = process.cwd()
  const root = path.join(cwd, 'public', 'uploads')
  if (existsSync(root)) return root
  const standalone = path.join(cwd, '.next', 'standalone', 'public', 'uploads')
  if (existsSync(standalone)) return standalone
  return root
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export function contentTypeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}
