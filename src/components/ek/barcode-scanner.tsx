'use client'

/**
 * Camera barcode scanner.
 *
 * Decoder strategy — the "engine" seam (pick a decoder at runtime, keep the
 * component API stable):
 *
 *   1. Native `BarcodeDetector` API when available (Chrome/Edge, Safari 17+)
 *      — zero extra bytes, hardware-accelerated, runs fully on-device.
 *   2. @zxing/browser fallback for older browsers (EAN-13/EAN-8/UPC-A/UPC-E).
 *   3. Future: when this app is packaged with Capacitor for the App Store /
 *      Play Store, register a native scanner engine (ML Kit on Android,
 *      VisionKit on iOS) as engine #0 in `createEngine()` below. Nothing
 *      else in the app needs to change — the UI talks to `onDetected(code)`.
 *
 * All processing is local: the video stream never leaves the device.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, BarcodeFormat, type IScannerControls } from '@zxing/browser'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Flashlight, Loader2, ScanBarcode, TriangleAlert } from 'lucide-react'
import { useLang, type TKey } from '@/lib/i18n'
import { toast } from 'sonner'

// --- minimal typings for the (not yet in TS lib) Barcode Detection API -----

type DetectedBarcode = { rawValue: string; format: string }
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

// --- GTIN validation (EAN-13 / EAN-8 / UPC-A / GTIN-14) ---------------------

/** Standard GS1 mod-10 check over the full code including the check digit. */
export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false
  const digits = code.split('').reverse().map(Number)
  let sum = 0
  for (let i = 1; i < digits.length; i++) sum += i % 2 === 1 ? digits[i] * 3 : digits[i]
  return (10 - (sum % 10)) % 10 === digits[0]
}

// --- engines ----------------------------------------------------------------

interface ScanEngine {
  start(video: HTMLVideoElement, stream: MediaStream, onResult: (code: string) => void): Promise<void>
  stop(): void
}

/** Native Barcode Detection API (Chrome/Edge, Safari 17+). */
class NativeEngine implements ScanEngine {
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false

  constructor(private readonly detector: BarcodeDetectorLike) {}

  async start(video: HTMLVideoElement, _stream: MediaStream, onResult: (code: string) => void) {
    this.stopped = false
    const tick = async () => {
      if (this.stopped || video.readyState < 2) return
      try {
        const codes = await this.detector.detect(video)
        if (codes.length > 0 && codes[0].rawValue) onResult(codes[0].rawValue)
      } catch {
        // frame not ready yet — keep looping
      }
    }
    void tick()
    this.timer = setInterval(() => void tick(), 180)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

/** ZXing JS fallback (older Safari/Firefox). */
class ZXingEngine implements ScanEngine {
  private controls: IScannerControls | null = null

  async start(video: HTMLVideoElement, stream: MediaStream, onResult: (code: string) => void) {
    const reader = new BrowserMultiFormatReader()
    reader.possibleFormats = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]
    this.controls = await reader.decodeFromStream(stream, video, (result) => {
      if (result) onResult(result.getText())
    })
  }

  stop() {
    this.controls?.stop()
    this.controls = null
  }
}

async function createEngine(): Promise<ScanEngine> {
  // Engine #0 (future): Capacitor native scanner bridge goes here.
  const BD = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (BD) {
    try {
      const supported = (await BD.getSupportedFormats?.()) ?? []
      const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => supported.includes(f))
      if (BD.getSupportedFormats === undefined || formats.length > 0) {
        return new NativeEngine(new BD(formats.length > 0 ? { formats } : undefined))
      }
    } catch {
      // fall through to ZXing
    }
  }
  return new ZXingEngine()
}

// --- UI ---------------------------------------------------------------------

type Phase = 'starting' | 'scanning' | 'error'

export function BarcodeScannerDialog({
  open,
  onOpenChange,
  onDetected,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onDetected: (code: string) => void
}) {
  const { t } = useLang()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('scanner.title')}</DialogTitle>
          <DialogDescription>{t('scanner.hint')}</DialogDescription>
        </DialogHeader>
        {open && (
          <ScannerBody
            onDetected={(code) => {
              onOpenChange(false)
              onDetected(code)
            }}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ScannerBody({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const { t } = useLang()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const engineRef = useRef<ScanEngine | null>(null)
  const aliveRef = useRef(true)
  const [phase, setPhase] = useState<Phase>('starting')
  const [errKey, setErrKey] = useState<TKey>('scanner.errGeneric')
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  const stopAll = useCallback(() => {
    aliveRef.current = false
    engineRef.current?.stop()
    engineRef.current = null
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }, [])

  const handleRaw = useCallback(
    (raw: string) => {
      const code = raw.replace(/\s+/g, '')
      if (!isValidGtin(code)) {
        toast.error(t('scanner.errMisread'))
        return
      }
      // 20–29 prefix = GS1 restricted distribution (in-store weight/price codes)
      if (/^\d{13}$/.test(code) && code.startsWith('2')) {
        toast.error(t('scanner.errInStore'))
        return
      }
      if (navigator.vibrate) navigator.vibrate(60)
      stopAll()
      onDetected(code)
    },
    [onDetected, stopAll, t],
  )

  const start = useCallback(async () => {
    setPhase('starting')
    setErrKey('scanner.errGeneric')
    setTorchAvailable(false)
    setTorchOn(false)
    aliveRef.current = true

    const video = videoRef.current
    if (!video) return
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setErrKey('scanner.errInsecure')
      setPhase('error')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (!aliveRef.current) {
        stream.getTracks().forEach((tr) => tr.stop())
        return
      }
      streamRef.current = stream
      video.srcObject = stream
      await video.play().catch(() => undefined)

      const track = stream.getVideoTracks()[0]
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean }
      setTorchAvailable(Boolean(caps.torch))

      const engine = await createEngine()
      if (!aliveRef.current) {
        engine.stop()
        return
      }
      engineRef.current = engine
      await engine.start(video, stream, handleRaw)
      setPhase('scanning')
    } catch (err) {
      if (!aliveRef.current) return
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') setErrKey('scanner.errPermission')
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setErrKey('scanner.errNoCamera')
      else setErrKey('scanner.errGeneric')
      setPhase('error')
      stopAll()
    }
  }, [handleRaw, stopAll])

  useEffect(() => {
    // Defer one tick: start() sets UI state synchronously, which the
    // set-state-in-effect rule (correctly) forbids in the effect body itself.
    const id = setTimeout(() => void start(), 0)
    return () => {
      clearTimeout(id)
      stopAll()
    }
  }, [start, stopAll])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      setTorchAvailable(false)
    }
  }

  return (
    <div>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />

        {phase === 'scanning' && (
          <>
            {/* reticle with darkened surroundings */}
            <div
              className="absolute inset-x-8 top-1/2 h-40 -translate-y-1/2 rounded-xl border-2 border-white/80"
              style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}
              aria-hidden
            >
              <div className="animate-scanline absolute inset-x-3 top-0.5 h-0.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
            </div>
            {torchAvailable && (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                aria-label={t('scanner.torch')}
                className="absolute right-3 top-3 rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <Flashlight className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </>
        )}

        {phase === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90" aria-live="polite">
            <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
            <p className="text-sm">{t('scanner.starting')}</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" aria-live="assertive">
            <TriangleAlert className="h-8 w-8 text-amber-400" aria-hidden />
            <p className="text-sm font-semibold text-white">{t('scanner.errTitle')}</p>
            <p className="max-w-xs text-xs text-white/80">{t(errKey)}</p>
            <Button type="button" size="sm" variant="secondary" className="mt-1" onClick={() => void start()}>
              {t('scanner.retry')}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ScanBarcode className="h-3.5 w-3.5" aria-hidden />
          {t('scanner.hint')}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            stopAll()
            onClose()
          }}
        >
          {t('common.close')}
        </Button>
      </div>
    </div>
  )
}
