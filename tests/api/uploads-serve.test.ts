import '../setup'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { unlink } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { GET as serveGET } from '@/app/uploads/[file]/route'
import { POST as uploadPOST } from '@/app/api/upload/route'
import { createToken } from '@/lib/auth'
import { mockAuth, req } from '../setup'
import { mkUser, wipeDb } from '../fixtures'
import { uploadsDir } from '@/lib/uploads'

const createdFiles: string[] = []

beforeEach(async () => {
  await wipeDb()
})

afterAll(async () => {
  for (const f of createdFiles) {
    await unlink(f).catch(() => undefined)
  }
})

async function storePng(): Promise<{ url: string; bytes: number[] }> {
  const user = await mkUser()
  mockAuth(`Bearer ${createToken(user.id)}`)
  // Real decodable PNG — the upload pipeline (30E) rejects fake bytes.
  const realPng = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 5, g: 6, b: 7 } } })
    .png()
    .toBuffer()
  const form = new FormData()
  form.append('file', new File([new Uint8Array(realPng)], 'front.png', { type: 'image/png' }))
  const res = await uploadPOST(req('POST', '/api/upload', form))
  expect(res.status).toBe(200)
  const { url } = (await res.json()) as { url: string }
  createdFiles.push(path.join(uploadsDir(), url.replace('/uploads/', '')))
  return { url, bytes: Array.from(new Uint8Array(realPng)) }
}

describe('GET /uploads/[file] — volume fallback server', () => {
  test('serves a stored file with the right type and immutable caching', async () => {
    const { url } = await storePng()
    const name = url.split('/').pop() as string

    const res = await serveGET(req('GET', url), { params: Promise.resolve({ file: name }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('immutable')
    // Served bytes are a real decodable PNG.
    const meta = await sharp(await res.arrayBuffer()).metadata()
    expect(meta.format).toBe('png')
  })

  test('404 for unknown files', async () => {
    const res = await serveGET(req('GET', '/uploads/nope.png'), {
      params: Promise.resolve({ file: 'nope.png' }),
    })
    expect(res.status).toBe(404)
  })

  test('404 for traversal attempts', async () => {
    const res = await serveGET(req('GET', '/uploads/..%2F..%2Fsecret.png'), {
      params: Promise.resolve({ file: '../../secret.png' }),
    })
    expect(res.status).toBe(404)
  })

  test('404 for non-image extensions', async () => {
    const res = await serveGET(req('GET', '/uploads/notes.txt'), {
      params: Promise.resolve({ file: 'notes.txt' }),
    })
    expect(res.status).toBe(404)
  })
})
