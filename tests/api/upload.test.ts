import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { POST as uploadPOST } from '@/app/api/upload/route'
import { createToken } from '@/lib/auth'
import { mockAuth, req } from '../setup'
import { mkUser, wipeDb } from '../fixtures'
import { uploadsDir } from '@/lib/uploads'
import path from 'path'
import sharp from 'sharp'

// Real decodable fixtures (30E): the pipeline rejects fake bytes by design.
const realPng = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 9, g: 9, b: 9 } } })
  .png()
  .toBuffer()
const realJpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 1, b: 1 } } })
  .jpeg()
  .toBuffer()
const realWebp = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 2, g: 2, b: 2 } } })
  .webp()
  .toBuffer()

beforeEach(async () => {
  await wipeDb()
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
    form.append('file', new File([new Uint8Array(realPng)], 'front.png', { type: 'image/png' }))

    const res = await uploadPOST(req('POST', '/api/upload', form))
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    expect(url.startsWith('/uploads/')).toBe(true)
    expect(url.endsWith('.png')).toBe(true)

    // The stored bytes are a real, decodable normalized PNG (not the input).
    const onDisk = path.join(uploadsDir(), url.replace('/uploads/', ''))
    const meta = await sharp(await Bun.file(onDisk).arrayBuffer()).metadata()
    expect(meta.format).toBe('png')
  })

  test('accepts JPEG and WebP types too', async () => {
    const user = await mkUser()
    for (const [type, ext, bytes] of [
      ['image/jpeg', 'jpg', realJpeg],
      ['image/webp', 'webp', realWebp],
    ] as const) {
      mockAuth(`Bearer ${createToken(user.id)}`)
      const form = new FormData()
      form.append('file', new File([new Uint8Array(bytes)], `f.${ext}`, { type }))
      const res = await uploadPOST(req('POST', '/api/upload', form))
      expect(res.status).toBe(200)
      const { url } = (await res.json()) as { url: string }
      expect(url.endsWith(`.${ext}`)).toBe(true)
    }
  })
})
