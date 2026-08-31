'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Clock,
  Loader2,
  ScanBarcode,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageUpload } from '@/components/ek/image-upload'
import { DiffText } from '@/components/ek/diff-text'
import { EmptyState } from '@/components/ek/empty-state'
import { api } from '@/lib/api'
import { useLang } from '@/lib/i18n'
import { navigate } from '@/lib/router'
import { computeChangedFields, extractLabelValues } from '@/lib/label'
import type { LabelField, LabelValues, MeDTO, ProductDetailDTO, SubmitResult } from '@/lib/types'
import { cn } from '@/lib/utils'

type FormState = {
  barcode: string
  name: string
  brand: string
  ingredients: string
  servingSize: string
  calories: string
  protein: string
  carbs: string
  sugars: string
  fat: string
  salt: string
  frontImage: string | null
  ingredientsImage: string | null
  nutritionImage: string | null
}

const emptyForm: FormState = {
  barcode: '',
  name: '',
  brand: '',
  ingredients: '',
  servingSize: '',
  calories: '',
  protein: '',
  carbs: '',
  sugars: '',
  fat: '',
  salt: '',
  frontImage: null,
  ingredientsImage: null,
  nutritionImage: null,
}

const NUTRITION_FIELDS: { key: 'calories' | 'protein' | 'carbs' | 'sugars' | 'fat' | 'salt'; unit: string }[] = [
  { key: 'calories', unit: 'kcal' },
  { key: 'protein', unit: 'g' },
  { key: 'carbs', unit: 'g' },
  { key: 'sugars', unit: 'g' },
  { key: 'fat', unit: 'g' },
  { key: 'salt', unit: 'g' },
]

function valuesFromForm(f: FormState): LabelValues {
  return extractLabelValues(f)
}

export function SubmitView({
  barcodeParam,
  me,
  onNeedAuth,
}: {
  barcodeParam: string
  me: MeDTO
  onNeedAuth: () => void
}) {
  const { t } = useLang()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormState>({ ...emptyForm, barcode: barcodeParam })
  const [existing, setExisting] = useState<ProductDetailDTO | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // Check barcode against the DB whenever it becomes a full EAN.
  const checkBarcode = useCallback(async (barcode: string) => {
    if (!/^\d{8,14}$/.test(barcode)) {
      setExisting(null)
      return
    }
    setChecking(true)
    setError(null)
    try {
      const detail = await api.get<ProductDetailDTO>(`/api/products/${barcode}`)
      setExisting(detail)
      const cur = detail.current
      if (cur) {
        setForm((f) => ({
          ...f,
          name: cur.name,
          brand: cur.brand,
          ingredients: cur.ingredients,
          servingSize: cur.servingSize ?? '',
          calories: cur.calories?.toString() ?? '',
          protein: cur.protein?.toString() ?? '',
          carbs: cur.carbs?.toString() ?? '',
          sugars: cur.sugars?.toString() ?? '',
          fat: cur.fat?.toString() ?? '',
          salt: cur.salt?.toString() ?? '',
          frontImage: cur.frontImage,
          ingredientsImage: cur.ingredientsImage,
          nutritionImage: cur.nutritionImage,
        }))
      }
    } catch {
      setExisting(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (barcodeParam) void checkBarcode(barcodeParam)
     
  }, [barcodeParam])

  const autofill = async () => {
    if (!form.ingredientsImage) return
    setOcrBusy(true)
    setError(null)
    try {
      // Fetch the uploaded file and convert to a data URL for the vision API.
      const blob = await (await fetch(form.ingredientsImage)).blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('read failed'))
        reader.readAsDataURL(blob)
      })
      const ocr = await api.post<{ ingredients: string | null; nutrition: Partial<Record<'calories' | 'protein' | 'carbs' | 'sugars' | 'fat' | 'salt', number>> & { servingSize?: string | null } | null }>('/api/ocr', { image: dataUrl })
      setForm((f) => ({
        ...f,
        ingredients: ocr.ingredients ?? f.ingredients,
        servingSize: ocr.nutrition?.servingSize ?? f.servingSize,
        calories: ocr.nutrition?.calories != null ? String(ocr.nutrition.calories) : f.calories,
        protein: ocr.nutrition?.protein != null ? String(ocr.nutrition.protein) : f.protein,
        carbs: ocr.nutrition?.carbs != null ? String(ocr.nutrition.carbs) : f.carbs,
        sugars: ocr.nutrition?.sugars != null ? String(ocr.nutrition.sugars) : f.sugars,
        fat: ocr.nutrition?.fat != null ? String(ocr.nutrition.fat) : f.fat,
        salt: ocr.nutrition?.salt != null ? String(ocr.nutrition.salt) : f.salt,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setOcrBusy(false)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const payload = { ...form }
      const res = await api.post<SubmitResult>('/api/products', payload)
      setResult(res)
      setStep(4)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  // --- success screen ---
  if (step === 4 && result) {
    const live = result.status === 'auto_approved'
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16">
        <EmptyState
          icon={live ? <Check className="h-6 w-6 text-emerald-600" aria-hidden /> : <Clock className="h-6 w-6 text-amber-500" aria-hidden />}
          title={live ? t('submit.successLive') : t('submit.successPending')}
          body={live ? t('submit.successLiveBody') : t('submit.successPendingBody')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate(`product/${result.barcode}`)}>
                {t('common.viewProduct')}
              </Button>
              {!live && (
                <Button variant="outline" onClick={() => navigate('queue')}>
                  {t('submit.goToQueue')}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setForm(emptyForm)
                  setExisting(null)
                  setResult(null)
                  setStep(1)
                }}
              >
                {t('submit.addAnother')}
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  if (!me) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16">
        <EmptyState
          icon={<ScanBarcode className="h-6 w-6" aria-hidden />}
          title={t('submit.signInPrompt')}
          action={<Button className="bg-emerald-600 hover:bg-emerald-700" onClick={onNeedAuth}>{t('common.signIn')}</Button>}
        />
      </div>
    )
  }

  const currentValues: LabelValues | null = existing?.current
    ? {
        name: existing.current.name,
        brand: existing.current.brand,
        ingredients: existing.current.ingredients,
        servingSize: existing.current.servingSize,
        calories: existing.current.calories,
        protein: existing.current.protein,
        carbs: existing.current.carbs,
        sugars: existing.current.sugars,
        fat: existing.current.fat,
        salt: existing.current.salt,
        frontImage: existing.current.frontImage,
        ingredientsImage: existing.current.ingredientsImage,
        nutritionImage: existing.current.nutritionImage,
      }
    : null
  const nextValues = valuesFromForm(form)
  const changedFields: LabelField[] = currentValues ? computeChangedFields(nextValues, currentValues) : []

  const stepNames = [t('submit.step1'), t('submit.step2'), t('submit.step3')]

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">
        {existing ? t('submit.titleEdit') : t('submit.title')}
      </h1>

      {/* Stepper */}
      <ol className="mt-5 flex items-center gap-2" aria-label="Progress">
        {stepNames.map((name, i) => {
          const n = i + 1
          const active = step === n
          const done = step > n
          return (
            <li key={name} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => n < step && setStep(n)}
                disabled={n >= step}
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  done
                    ? 'bg-emerald-600 text-white'
                    : active
                      ? 'bg-foreground text-background'
                      : 'border text-muted-foreground',
                )}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
              </button>
              <span className={cn('hidden text-sm sm:block', active ? 'font-semibold' : 'text-muted-foreground')}>{name}</span>
              {n < 3 && <span className={cn('h-px flex-1', done ? 'bg-emerald-500' : 'bg-border')} />}
            </li>
          )
        })}
      </ol>

      {/* Step 1 — photos + barcode */}
      {step === 1 && (
        <Card className="mt-6 rounded-2xl">
          <CardContent className="space-y-5 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="barcode">{t('submit.barcode')}</Label>
              <div className="relative">
                <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="barcode"
                  inputMode="numeric"
                  pattern="\d*"
                  value={form.barcode}
                  onChange={(e) => set('barcode', e.target.value.replace(/\D/g, '').slice(0, 14))}
                  onBlur={() => void checkBarcode(form.barcode)}
                  placeholder="7310865004703"
                  className="pl-9 font-mono"
                />
                {checking && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
              </div>
              <p className="text-xs text-muted-foreground">{t('submit.barcodeHint')}</p>
              {existing && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                  {t('submit.editMode')} <strong>{existing.product.name}</strong>
                </p>
              )}
              {!existing && form.barcode.length >= 8 && !checking && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">{t('submit.newMode')}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ImageUpload label={t('submit.front')} value={form.frontImage} onChange={(url) => set('frontImage', url)} />
              <ImageUpload label={t('submit.photoIngredients')} value={form.ingredientsImage} onChange={(url) => set('ingredientsImage', url)} />
              <ImageUpload label={t('submit.photoNutrition')} value={form.nutritionImage} onChange={(url) => set('nutritionImage', url)} />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end">
              <Button
                onClick={() => setStep(2)}
                disabled={!/^\d{8,14}$/.test(form.barcode) || (!form.frontImage && !form.ingredientsImage && !form.nutritionImage)}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {t('common.next')}
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 — details */}
      {step === 2 && (
        <Card className="mt-6 rounded-2xl">
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="p-name">{t('submit.name')}</Label>
                <Input id="p-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-brand">{t('submit.brand')}</Label>
                <Input id="p-brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="p-ingredients">{t('submit.ingredients')}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!form.ingredientsImage || ocrBusy}
                  onClick={() => void autofill()}
                  className="h-7 text-xs"
                >
                  {ocrBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : <Sparkles className="mr-1 h-3 w-3 text-emerald-600" aria-hidden />}
                  {ocrBusy ? t('submit.autofillLoading') : t('submit.autofill')}
                </Button>
              </div>
              <Textarea
                id="p-ingredients"
                rows={5}
                value={form.ingredients}
                onChange={(e) => set('ingredients', e.target.value)}
                placeholder={t('submit.ingredientsPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('submit.autofillHint')}</p>
            </div>

            <div>
              <Label className="text-muted-foreground">{t('product.nutrition')} ({t('common.per100g')})</Label>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {NUTRITION_FIELDS.map(({ key, unit }) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={`n-${key}`} className="text-xs">{t(`field.${key}` as never)} ({unit})</Label>
                    <Input
                      id={`n-${key}`}
                      inputMode="decimal"
                      value={form[key]}
                      onChange={(e) => set(key, e.target.value.replace(/[^\d.,]/g, ''))}
                      className="h-9"
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label htmlFor="n-serving" className="text-xs">{t('product.servingSize')}</Label>
                  <Input
                    id="n-serving"
                    value={form.servingSize}
                    onChange={(e) => set('servingSize', e.target.value)}
                    placeholder="100 g"
                    className="h-9"
                  />
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
                {t('common.back')}
              </Button>
              <Button onClick={() => setStep(3)} disabled={form.name.trim().length < 2 || form.ingredients.trim().length < 5} className="bg-emerald-600 hover:bg-emerald-700">
                {t('common.next')}
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — review & submit */}
      {step === 3 && (
        <Card className="mt-6 rounded-2xl">
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="text-base font-semibold">{existing ? t('submit.diffTitle') : t('submit.summaryTitle')}</h2>
              {existing && changedFields.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {changedFields.map((f) => (
                    <Badge key={f} variant="secondary">{t(`field.${f}` as never)}</Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-muted/30 p-3">
              {existing && changedFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('product.noDiff')}</p>
              ) : existing ? (
                <div>
                  {changedFields.map((f) => {
                    const prev = (currentValues as Record<string, unknown>)[f]
                    const next = (nextValues as Record<string, unknown>)[f]
                    if (f === 'ingredients') {
                      return (
                        <div key={f} className="py-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('product.ingredients')}</p>
                          <DiffText oldText={String(prev ?? '')} newText={String(next ?? '')} className="mt-1 text-sm" />
                        </div>
                      )
                    }
                    return (
                      <div key={f} className="flex items-baseline gap-2 py-1">
                        <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t(`field.${f}` as never)}
                        </span>
                        <span className="text-sm">
                          <span className="rounded-sm bg-red-100 text-red-800 line-through dark:bg-red-950/70 dark:text-red-300">
                            {f.endsWith('Image') ? (prev ? t('common.photo') : '—') : String(prev ?? '—')}
                          </span>
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="rounded-sm bg-emerald-100 font-medium text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300">
                            {f.endsWith('Image') ? (next ? t('common.photo') : '—') : String(next ?? '—')}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div>
                  <p className="text-sm"><strong>{nextValues.name}</strong> <span className="text-muted-foreground">· {nextValues.brand} · {form.barcode}</span></p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{nextValues.ingredients}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {NUTRITION_FIELDS.map(({ key, unit }) => (form[key] ? `${t(`field.${key}` as never)} ${form[key]} ${unit}` : null))
                      .filter(Boolean)
                      .join(' · ') || t('product.noData')}
                  </p>
                </div>
              )}
            </div>

            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
              {me.trustLevel === 0
                ? t('submit.trustNoteNewcomer')
                : me.trustLevel === 1
                  ? t('submit.trustNoteContributor')
                  : t('submit.trustNoteTrusted')}
            </p>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)} disabled={submitting}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
                {t('common.back')}
              </Button>
              <Button onClick={() => void submit()} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700">
                {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Camera className="mr-1 h-4 w-4" aria-hidden />}
                {submitting ? t('submit.submitting') : existing ? t('submit.submitEdit') : t('submit.submitNew')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* loading skeleton on first paint with barcode param */}
      {checking && barcodeParam && !existing && step === 1 && (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      )}
    </div>
  )
}
