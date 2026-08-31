import '../setup'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { unlink } from 'fs/promises'
import path from 'path'
import { POST as uploadPOST } from '@/app/api/upload/route'
import { createToken } from '@/lib/auth'
import { mockAuth, req } from '../setup'
import { mkUser, wipeDb } from '../fixtures'

const createdFiles: string[] = []

beforeEach(async () => {
  await wipeDb()
})

afterAll(async () => {
  // remove files written to public/uploads during the test run
  for (const f of createdFiles) {
    await unlink(f).catch(() => undefined)
  }
})

function pngFile(size = 100): File {
  return new File([new Uint8Array(size)], 'front.png', { type: 'image/png' })
}

describe('POST /api/upload', () => {
  test('401 for anonymous users', async () => {
    const form = new FormData()
    form.append('file', pngFile())
    const res = await uploadPOST(req('POST', '/api/upload', form))
    expect(res.status).toBe(401)
  })

  test('400 when no file is sent', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const res = await uploadPOST(req('POST', '/api/upload', new FormData()))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('No file')
  })

  test('400 for disallowed mime types', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const form = new FormData()
    form.append('file', new File([new Uint8Array(10)], 'notes.txt', { type: 'text/plain' }))
    const res = await uploadPOST(req('POST', '/api/upload', form))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('JPEG, PNG or WebP')
  })

  test('400 for files over 8 MB', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const form = new FormData()
    form.append('file', new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    const res = await uploadPOST(req('POST', '/api/upload', form))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('8 MB')
  })

  test('stores a PNG and returns its public URL', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)

    const form = new FormData()
    const bytes = new Uint8Array(137)
    bytes[0] = 0x89 // PNG magic
    form.append('file', new File([bytes], 'front.png', { type: 'image/png' }))

    const res = await uploadPOST(req('POST', '/api/upload', form))
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    expect(url.startsWith('/uploads/')).toBe(true)
    expect(url.endsWith('.png')).toBe(true)

    const onDisk = path.join(process.cwd(), 'public', url)
    createdFiles.push(onDisk)
    const written = await Bun.file(onDisk).arrayBuffer()
    expect(written.byteLength).toBe(137)
  })

  test('accepts JPEG and WebP types too', async () => {
    const user = await mkUser()
    for (const [type, ext] of [
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
    ] as const) {
      mockAuth(`Bearer ${createToken(user.id)}`)
      const form = new FormData()
      form.append('file', new File([new Uint8Array(10)], `f.${ext}`, { type }))
      const res = await uploadPOST(req('POST', '/api/upload', form))
      expect(res.status).toBe(200)
      const { url } = (await res.json()) as { url: string }
      expect(url.endsWith(`.${ext}`)).toBe(true)
      createdFiles.push(path.join(process.cwd(), 'public', url))
    }
  })
})
