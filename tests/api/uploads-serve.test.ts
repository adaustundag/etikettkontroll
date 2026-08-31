import '../setup'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { unlink } from 'fs/promises'
import path from 'path'
import { GET as serveGET } from '@/app/uploads/[file]/route'
import { POST as uploadPOST } from '@/app/api/upload/route'
import { createToken } from '@/lib/auth'
import { mockAuth, req } from '../setup'
import { mkUser, wipeDb } from '../fixtures'

const createdFiles: string[] = []

beforeEach(async () => {
  await wipeDb()
})

afterAll(async () => {
  for (const f of createdFiles) {
    await unlink(f).catch(() => undefined)
  }
})

async function storePng(bytes: number[]): Promise<string> {
  const user = await mkUser()
  mockAuth(`Bearer ${createToken(user.id)}`)
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], 'front.png', { type: 'image/png' }))
  const res = await uploadPOST(req('POST', '/api/upload', form))
  expect(res.status).toBe(200)
  const { url } = (await res.json()) as { url: string }
  createdFiles.push(path.join(process.cwd(), 'public', url))
  return url
}

describe('GET /uploads/[file] — volume fallback server', () => {
  test('serves a stored file with the right type and immutable caching', async () => {
    const bytes = [137, 80, 78, 71, 1, 2, 3, 4, 5]
    const url = await storePng(bytes)
    const name = url.split('/').pop() as string

    const res = await serveGET(req('GET', url), { params: Promise.resolve({ file: name }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(bytes)
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
