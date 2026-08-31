'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, Plus, ScanBarcode } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { navigate } from '@/lib/router'
import { ProductThumb } from '@/components/ek/product-thumb'
import { BarcodeScannerDialog } from '@/components/ek/barcode-scanner'
import type { SearchItemDTO } from '@/lib/types'

export function SearchBox() {
  const { t } = useLang()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchItemDTO[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const items = await api.get<SearchItemDTO[]>(`/api/products?q=${encodeURIComponent(q)}`)
        setResults(items)
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const isBarcode = /^\d{8,14}$/.test(query.trim())

  const go = (path: string) => {
    setOpen(false)
    navigate(path)
  }

  // Scanned a barcode from the home screen: the submit wizard handles both
  // cases — existing product (edit mode, prefilled) or new product.
  const onScan = (code: string) => {
    setScanOpen(false)
    setQuery('')
    setResults(null)
    go(`submit/${code}`)
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (results && results.length > 0) go(`product/${results[0].barcode}`)
            else if (isBarcode) go(`product/${query.trim()}`)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder={t('home.searchPlaceholder')}
        className="h-14 rounded-2xl border-zinc-300 bg-white pl-12 pr-12 text-base shadow-sm focus-visible:ring-emerald-500 dark:border-zinc-700"
        aria-label={t('home.searchPlaceholder')}
        inputMode="text"
      />
      {loading && <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      {!loading && (
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label={t('scanner.title')}
        >
          <ScanBarcode className="h-5 w-5" aria-hidden />
        </button>
      )}

      {open && (results !== null || isBarcode) && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border bg-popover shadow-lg">
          {results && results.length > 0 && (
            <ul className="max-h-80 overflow-y-auto">
              {results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      go(`product/${item.barcode}`)
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <ProductThumb src={null} name={item.name} className="h-10 w-10 shrink-0 rounded-lg text-base" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.brand} · {item.barcode}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results && results.length === 0 && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                go(isBarcode ? `submit/${query.trim()}` : 'submit')
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <Plus className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-sm">
                {isBarcode ? t('home.noResultsBarcode') : t('home.noResults')}
                {isBarcode && <span className="ml-1 font-mono font-medium">{query.trim()}</span>}
              </span>
            </button>
          )}
        </div>
      )}

      <BarcodeScannerDialog open={scanOpen} onOpenChange={setScanOpen} onDetected={onScan} />
    </div>
  )
}
