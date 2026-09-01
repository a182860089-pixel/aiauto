import sharp from 'sharp'
import { createHash } from 'node:crypto'
import type { SliceRef } from './types.js'

export type PreprocessedImage = {
  dataUrl: string
  width: number
  height: number
  sha256: string
}

export type SmartSlice = SliceRef & { dataUrl: string }

type GrayImage = { data: Buffer; width: number; height: number; channels: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function dataUrlFromBuffer(buffer: Buffer, mime = 'image/jpeg') {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

function bufferFromDataUrl(dataUrl: string) {
  const match = /^data:[^;]+;base64,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('图片必须是 base64 Data URL')
  return Buffer.from(match[1], 'base64')
}

/**
 * 保持宽高比缩放，使用 CLAHE 拉开暗部小字的局部对比度，并做轻度中值去噪。
 */
export async function preprocessImage(dataUrl: string, maxEdge = 3200): Promise<PreprocessedImage> {
  const input = bufferFromDataUrl(dataUrl)
  const image = sharp(input, { failOn: 'none' })
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height) throw new Error('无法读取图片尺寸')
  const scale = maxEdge / Math.max(metadata.width, metadata.height)
  const width = Math.max(1, Math.round(metadata.width * scale))
  const height = Math.max(1, Math.round(metadata.height * scale))
  const output = await image
    .rotate()
    .resize({ width, height, fit: 'inside' })
    .grayscale()
    .clahe({ width: 8, height: 8, maxSlope: 3 })
    .median(3)
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4', progressive: true })
    .toBuffer()
  return { dataUrl: dataUrlFromBuffer(output), width, height, sha256: createHash('sha256').update(output).digest('hex') }
}

async function grayscaleRaw(dataUrl: string): Promise<GrayImage> {
  const result = await sharp(bufferFromDataUrl(dataUrl), { failOn: 'none' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  return { data: result.data, width: result.info.width, height: result.info.height, channels: result.info.channels }
}

function rowInkScores(image: GrayImage) {
  const scores = Array<number>(image.height).fill(0)
  for (let y = 0; y < image.height; y += 1) {
    let dark = 0
    let transitions = 0
    let previous = 255
    for (let x = 0; x < image.width; x += 1) {
      const value = image.data[(y * image.width + x) * image.channels]
      if (value < 150) dark += 1
      if (Math.abs(value - previous) > 35) transitions += 1
      previous = value
    }
    // Lines have many dark pixels and long horizontal continuity; text rows have fewer.
    scores[y] = dark / image.width + Math.min(0.2, transitions / image.width / 5)
  }
  return scores
}

function findHeaderEnd(scores: number[], height: number) {
  const start = Math.floor(height * 0.04)
  const end = Math.min(Math.floor(height * 0.32), height - 1)
  let best = Math.floor(height * 0.14)
  let bestScore = -1
  for (let y = start; y <= end; y += 1) {
    const score = scores[y]
    if (score > bestScore) {
      bestScore = score
      best = y
    }
  }
  // Keep enough header pixels even when the first separator is faint.
  return clamp(best + 2, Math.max(40, Math.floor(height * 0.06)), Math.min(height - 1, Math.floor(height * 0.28)))
}

function localCut(scores: number[], target: number, lower: number, upper: number) {
  const from = clamp(Math.floor(target - (upper - lower) * 0.22), lower, upper)
  const to = clamp(Math.ceil(target + (upper - lower) * 0.22), from, upper)
  let cut = clamp(Math.round(target), lower, upper)
  let best = Number.POSITIVE_INFINITY
  for (let y = from; y <= to; y += 1) {
    const lineScore = scores[y] ?? 0
    const neighborhood = ((scores[y - 1] ?? lineScore) + lineScore + (scores[y + 1] ?? lineScore)) / 3
    // Prefer a blank valley, then a horizontal line, and never cut on a dense text row.
    const value = neighborhood > 0.62 ? 2 + neighborhood : neighborhood
    if (value < best) {
      best = value
      cut = y
    }
  }
  return cut
}

function buildCuts(scores: number[], headerEnd: number, maxBodyHeight: number) {
  const bodyHeight = scores.length - headerEnd
  if (bodyHeight <= maxBodyHeight) return [headerEnd, scores.length]
  const count = Math.ceil(bodyHeight / maxBodyHeight)
  const cuts = [headerEnd]
  for (let index = 1; index < count; index += 1) {
    const target = headerEnd + (bodyHeight * index) / count
    const lower = cuts[cuts.length - 1] + 80
    const upper = scores.length - (count - index) * 80
    cuts.push(localCut(scores, target, lower, upper))
  }
  cuts.push(scores.length)
  return cuts
}

async function renderSlice(dataUrl: string, headerEnd: number, bodyStart: number, bodyEnd: number) {
  const input = bufferFromDataUrl(dataUrl)
  const meta = await sharp(input, { failOn: 'none' }).metadata()
  if (!meta.width) throw new Error('无法读取切片宽度')
  const header = await sharp(input).extract({ left: 0, top: 0, width: meta.width, height: headerEnd }).toBuffer()
  const body = await sharp(input).extract({ left: 0, top: bodyStart, width: meta.width, height: bodyEnd - bodyStart }).toBuffer()
  const output = await sharp({
    create: { width: meta.width, height: headerEnd + bodyEnd - bodyStart, channels: 3, background: '#ffffff' },
  }).composite([
    { input: header, left: 0, top: 0 },
    { input: body, left: 0, top: headerEnd },
  ]).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer()
  return dataUrlFromBuffer(output)
}

/**
 * 基于水平投影动态寻找表头分隔线和行安全切点。每片都重复携带原图表头。
 */
export async function smartSlice(dataUrl: string, options: { maxBodyHeight?: number } = {}): Promise<SmartSlice[]> {
  const image = await grayscaleRaw(dataUrl)
  const scores = rowInkScores(image)
  const headerEnd = findHeaderEnd(scores, image.height)
  const maxBodyHeight = options.maxBodyHeight ?? 1500
  const cuts = buildCuts(scores, headerEnd, maxBodyHeight)
  const slices: SmartSlice[] = []
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const bodyStart = cuts[index]
    const bodyEnd = cuts[index + 1]
    const rendered = await renderSlice(dataUrl, headerEnd, bodyStart, bodyEnd)
    slices.push({
      index,
      blobHash: createHash('sha256').update(bufferFromDataUrl(rendered)).digest('hex'),
      stage: 'PENDING',
      sourceYStart: bodyStart,
      sourceYEnd: bodyEnd,
      headerYStart: 0,
      headerYEnd: headerEnd,
      rowStart: index === 0 ? 0 : bodyStart - headerEnd,
      rowEnd: bodyEnd - headerEnd,
      attempts: 0,
      dataUrl: rendered,
    })
  }
  return slices
}
