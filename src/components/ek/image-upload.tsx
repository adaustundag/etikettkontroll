'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

async function resizeImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const max = 1200
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export function ImageUpload({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string | null
  onChange: (url: string | null) => void
  disabled?: boolean
}) {
  const { t } = useLang()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const handleFile = async (file: File | undefined) => {
    if (!file || disabled) return
    setBusy(true)
    try {
      const resized = await resizeImage(file)
      const { url } = await api.upload(resized)
      onChange(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors',
          value ? 'border-transparent' : 'border-zinc-300 hover:border-emerald-400 dark:border-zinc-700',
          disabled && 'opacity-60',
        )}
        aria-label={`${label}: ${t('submit.slotHint')}`}
      >
        {value ? (
          <>
            { }
            <img src={value} alt={label} className="absolute inset-0 h-full w-full object-cover" />
            <span
              role="button"
              tabIndex={0}
              aria-label={`${t('common.cancel')} ${label}`}
              onClick={(e) => {
                e.stopPropagation()
                onChange(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  onChange(null)
                }
              }}
              className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
            >
              <X className="h-4 w-4" aria-hidden />
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1.5 p-3 text-center text-muted-foreground">
            {busy ? (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="h-6 w-6" aria-hidden />
            )}
            <span className="text-xs">{busy ? t('submit.uploading') : t('submit.slotHint')}</span>
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
