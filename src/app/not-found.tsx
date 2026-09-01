import type { Metadata } from 'next'
import Link from 'next/link'
import { ScanBarcode } from 'lucide-react'
import { siteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Sidan hittades inte',
  robots: { index: false, follow: true },
  alternates: { canonical: `${siteUrl()}` },
}

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <ScanBarcode className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Sidan hittades inte</h1>
      <p className="mt-3 text-muted-foreground">
        Produkten eller sidan du letar efter finns inte — eller så har streckkoden skrivits fel.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          Till startsidan
        </Link>
        <Link
          href="/submit"
          className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          Lägg till produkt
        </Link>
      </div>
    </div>
  )
}
