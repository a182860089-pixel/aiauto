import { createHash } from 'node:crypto'
import { normalizeRecord } from './normalizer.js'
import type { VisionResult } from './types.js'

export function normalizeHeader(value: string) {
  return value.replace(/[\s:_：/\\()（）\[\]【】.-]/g, '').toLowerCase()
}

function collectColumns(results: VisionResult[]) {
  const columns: string[] = []
  for (const result of results) {
    for (const column of result.table.columns) {
      if (column && !columns.some((current) => normalizeHeader(current) === normalizeHeader(column))) columns.push(column)
    }
  }
  return columns
}

function isHeaderRow(row: string[], columns: string[]) {
  const matched = row.filter((cell, index) => normalizeHeader(cell) === normalizeHeader(columns[index] || '')).length
  return matched >= Math.max(2, Math.ceil(columns.length / 3))
}

function rowIdentity(columns: string[], row: string[]) {
  const significant = columns.map((column, index) => `${normalizeHeader(column)}=${row[index]?.trim() || ''}`).join('|')
  return createHash('sha256').update(significant).digest('hex')
}

/** 按真实表头映射各片列，去除重复表头、空行和切片边界重复行。 */
export function mergeVisionResults(results: VisionResult[]) {
  const columns = collectColumns(results)
  const seen = new Set<string>()
  const rows: string[][] = []
  for (const result of results.sort((left, right) => (left.sliceIndex ?? 0) - (right.sliceIndex ?? 0))) {
    const sourceColumns = result.table.columns.length ? result.table.columns : columns
    for (const rawRow of result.table.rows) {
      const source = Array.isArray(rawRow)
        ? Object.fromEntries(sourceColumns.map((column, index) => [column, String(rawRow[index] ?? '')]))
        : Object.fromEntries(Object.entries(rawRow).map(([key, value]) => [key, String(value ?? '')]))
      const row = columns.map((column) => {
        const sourceKey = Object.keys(source).find((candidate) => normalizeHeader(candidate) === normalizeHeader(column))
        return sourceKey ? source[sourceKey].trim() : ''
      })
      if (row.every((cell) => !cell) || isHeaderRow(row, columns)) continue
      const identity = rowIdentity(columns, row)
      if (seen.has(identity)) continue
      seen.add(identity)
      rows.push(row)
    }
  }
  const records = rows.map((row) => normalizeRecord(Object.fromEntries(columns.map((column, index) => [column, row[index]]))))
  return { columns, rows, records }
}
