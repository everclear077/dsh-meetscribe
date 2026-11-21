export interface SpeakerCentroid {
  id: string
  vector: Float32Array
  count: number
}

export interface ClusterResult {
  speakerId: string
  confidence: number
  isNew: boolean
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < n; i++) {
    const av = Number(a[i]) || 0
    const bv = Number(b[i]) || 0
    dot += av * bv
    aa += av * av
    bb += bv * bv
  }
  if (aa === 0 || bb === 0) return 0
  return dot / Math.sqrt(aa * bb)
}

function normalized(values: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(values)
  let norm = 0
  for (const v of out) norm += v * v
  if (norm > 0) {
    const scale = 1 / Math.sqrt(norm)
    for (let i = 0; i < out.length; i++) out[i] *= scale
  }
  return out
}

/** Small, deterministic online clustering for anonymous meeting speakers. */
export class SpeakerClusterer {
  private readonly centroids = new Map<string, SpeakerCentroid>()

  constructor(private readonly threshold = 0.56, private readonly maxSpeakers = 8) {}

  reset(): void {
    this.centroids.clear()
  }

  add(embedding: ArrayLike<number>, createId: () => string): ClusterResult {
    const vector = normalized(embedding)
    if (vector.length === 0 || vector.every((v) => v === 0)) {
      const fallback = this.centroids.keys().next().value as string | undefined
      const id = fallback ?? createId()
      if (!fallback) this.centroids.set(id, { id, vector, count: 1 })
      return { speakerId: id, confidence: 0, isNew: !fallback }
    }

    let best: SpeakerCentroid | undefined
    let confidence = -1
    for (const centroid of this.centroids.values()) {
      const similarity = cosineSimilarity(vector, centroid.vector)
      if (similarity > confidence) {
        best = centroid
        confidence = similarity
      }
    }

    const isNew = !best || (confidence < this.threshold && this.centroids.size < this.maxSpeakers)
    if (isNew) {
      const id = createId()
      this.centroids.set(id, { id, vector, count: 1 })
      return { speakerId: id, confidence: Math.max(0, confidence), isNew: true }
    }

    if (!best) throw new Error('Speaker cluster invariant violated')
    best.count += 1
    for (let i = 0; i < best.vector.length; i++) {
      best.vector[i] = best.vector[i] + (vector[i] - best.vector[i]) / best.count
    }
    best.vector = normalized(best.vector)
    return { speakerId: best.id, confidence, isNew: false }
  }

  get size(): number {
    return this.centroids.size
  }
}

export function removeFillerWords(text: string): string {
  return text
    .replace(/(^|[，。！？；、\s])(?:嗯+|啊+|呃+|额+|这个|就是说|那个)(?=[，。！？；、\s]|$)/gu, '$1')
    .replace(/([，。！？；、])\s*(?=[，。！？；、])/gu, '$1')
    .replace(/^[，；、\s]+/u, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}
