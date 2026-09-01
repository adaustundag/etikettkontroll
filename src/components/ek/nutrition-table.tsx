'use client'

import { useLang } from '@/lib/i18n'
import { formatValue } from '@/lib/label'
import type { LabelValues } from '@/lib/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export function NutritionTable({ values }: { values: LabelValues }) {
  const { t } = useLang()
  const rows: { field: 'calories' | 'protein' | 'carbs' | 'sugars' | 'fat' | 'salt'; unit: string }[] = [
    { field: 'calories', unit: 'kcal' },
    { field: 'fat', unit: 'g' },
    { field: 'carbs', unit: 'g' },
    { field: 'sugars', unit: 'g' },
    { field: 'protein', unit: 'g' },
    { field: 'salt', unit: 'g' },
  ]
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('product.nutrition')}</TableHead>
          <TableHead className="text-right">{t('common.per100g')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ field, unit }) => {
          const value = values[field]
          return (
            <TableRow key={field}>
              <TableCell className="text-muted-foreground">{t(`field.${field}` as never)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {value === null ? (
                  <span className="text-muted-foreground/60">{t('product.noData')}</span>
                ) : (
                  <>
                    {formatValue(field, value)} <span className="text-muted-foreground text-xs">{unit}</span>
                  </>
                )}
              </TableCell>
            </TableRow>
          )
        })}
        {values.servingSize && (
          <TableRow>
            <TableCell colSpan={2} className="text-xs text-muted-foreground">
              {t('product.servingInfo', { size: values.servingSize })}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
