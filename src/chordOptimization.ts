import {
  CHORD_PREVIEW_MIN_LENGTH,
  createPreviewLine,
  isPreviewValid,
} from './chordPreview'
import { GEOMETRY_EPSILON, getDistance, isPointOnLineSegment } from './geometry'
import {
  buildLegalLineSegments,
  getClosestPointOnSegment,
  isLegalLineSegment,
} from './lineSegments'
import type { Area, LegalLineSegment, Line, Point } from './types'
import type { SnappedPoint } from './useGameState'
import { getSplitMoveResult, isSplitMoveAllowed } from './useGameState'

const SPLIT_TARGET = 5
const MAX_FALLBACK_DISTANCE = 0.35
const GRID_STEPS = 128
const BISECTION_ITERS = 60
const GOLDEN_ITERS = 56
const AREA_ROOT_TOL = 1e-7

const segmentAsLine = (segment: LegalLineSegment): Line => ({
  id: segment.id,
  x1: segment.start.x,
  y1: segment.start.y,
  x2: segment.end.x,
  y2: segment.end.y,
  color: 'neutral',
  choice: 0,
})

const findLegalSegmentContainingPoint = (
  segments: LegalLineSegment[],
  snapped: SnappedPoint,
): LegalLineSegment | null => {
  const candidates = segments.filter(
    (segment) => segment.lineId === snapped.lineId && isLegalLineSegment(segment),
  )

  for (const segment of candidates) {
    if (isPointOnLineSegment(snapped.point, segmentAsLine(segment))) {
      return segment
    }
  }

  return null
}

/**
 * Prefer the segment that contains the snapped point; if float noise breaks the
 * on-segment test, fall back to the closest legal sub-segment on that line.
 */
const resolveSegmentForEnd = (
  segments: LegalLineSegment[],
  snapped: SnappedPoint,
): LegalLineSegment | null => {
  const contained = findLegalSegmentContainingPoint(segments, snapped)

  if (contained) {
    return contained
  }

  const candidates = segments.filter(
    (segment) => segment.lineId === snapped.lineId && isLegalLineSegment(segment),
  )

  let chosen: LegalLineSegment | null = null
  let chosenDistance = Infinity

  for (const segment of candidates) {
    const closest = getClosestPointOnSegment(snapped.point, segment)
    const distance = getDistance(snapped.point, closest)

    if (distance < chosenDistance) {
      chosenDistance = distance
      chosen = segment
    }
  }

  if (chosen && chosenDistance <= MAX_FALLBACK_DISTANCE) {
    return chosen
  }

  return null
}

const pointOnSegmentT = (segment: LegalLineSegment, t: number): Point => ({
  x: segment.start.x + t * (segment.end.x - segment.start.x),
  y: segment.start.y + t * (segment.end.y - segment.start.y),
})

const projectPointToSegmentT = (segment: LegalLineSegment, point: Point): number => {
  const deltaX = segment.end.x - segment.start.x
  const deltaY = segment.end.y - segment.start.y
  const lengthSquared = deltaX ** 2 + deltaY ** 2

  if (lengthSquared <= GEOMETRY_EPSILON) {
    return 0
  }

  const projection =
    ((point.x - segment.start.x) * deltaX + (point.y - segment.start.y) * deltaY) / lengthSquared

  return Math.min(1, Math.max(0, projection))
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

type ChordMetricSample = {
  end: SnappedPoint
  a0: number
  a1: number
}

type ScoredCandidate = {
  t: number
  end: SnappedPoint
  a0: number
  a1: number
  metric: number
}

function pickBetterCandidate(
  previous: ScoredCandidate | null,
  t: number,
  sample: ChordMetricSample,
  metric: number,
  aimPoint: Point,
  tSeed: number,
): ScoredCandidate {
  const next: ScoredCandidate = { t, end: sample.end, a0: sample.a0, a1: sample.a1, metric }

  if (previous === null) {
    return next
  }

  if (next.metric < previous.metric - 1e-12) {
    return next
  }

  if (previous.metric < next.metric - 1e-12) {
    return previous
  }

  const dNext = getDistance(next.end.point, aimPoint)
  const dPrev = getDistance(previous.end.point, aimPoint)

  if (dNext < dPrev - GEOMETRY_EPSILON) {
    return next
  }

  if (dPrev < dNext - GEOMETRY_EPSILON) {
    return previous
  }

  return Math.abs(next.t - tSeed) < Math.abs(previous.t - tSeed) ? next : previous
}

const makeEvalAt =
  (
    start: SnappedPoint,
    lineId: string,
    L2: LegalLineSegment,
    lines: Line[],
    areas: Area[],
  ) =>
  (t: number): ChordMetricSample | null => {
    const tUse = clamp01(t)
    const p2 = pointOnSegmentT(L2, tUse)
    const end: SnappedPoint = { point: p2, lineId }

    if (getDistance(start.point, p2) < CHORD_PREVIEW_MIN_LENGTH + GEOMETRY_EPSILON) {
      return null
    }

    if (!isPreviewValid(start, end, lines, areas)) {
      return null
    }

    const previewLine = createPreviewLine(start, end)
    const split = getSplitMoveResult(areas, lines, previewLine)

    if (!split || !isSplitMoveAllowed(split)) {
      return null
    }

    const [f0, f1] = split.splitResult.areas

    return { end, a0: f0.geometricArea, a1: f1.geometricArea }
  }

const imbalanceOf = (e: ChordMetricSample) => Math.abs(e.a0 - e.a1)

const splitFiveScoreOf = (e: ChordMetricSample) =>
  Math.min(Math.abs(e.a0 - SPLIT_TARGET), Math.abs(e.a1 - SPLIT_TARGET))

const bisectRoot = (
  evaluateAt: (t: number) => ChordMetricSample | null,
  tLo: number,
  tHi: number,
  value: (e: ChordMetricSample) => number,
): number | null => {
  let lo = tLo
  let hi = tHi
  const eLo = evaluateAt(lo)
  const eHi = evaluateAt(hi)

  if (!eLo || !eHi) {
    return null
  }

  let vLo = value(eLo)
  const vHi = value(eHi)

  if (Math.abs(vLo) < AREA_ROOT_TOL) {
    return lo
  }

  if (Math.abs(vHi) < AREA_ROOT_TOL) {
    return hi
  }

  if (vLo * vHi > 0) {
    return null
  }

  for (let i = 0; i < BISECTION_ITERS; i += 1) {
    const mid = (lo + hi) / 2
    const eMid = evaluateAt(mid)

    if (!eMid) {
      return null
    }

    const vMid = value(eMid)

    if (Math.abs(vMid) < AREA_ROOT_TOL) {
      return mid
    }

    if (vLo * vMid <= 0) {
      hi = mid
    } else {
      lo = mid
      vLo = vMid
    }
  }

  return (lo + hi) / 2
}

const goldenSectionMinimize = (
  evaluateAt: (t: number) => ChordMetricSample | null,
  score: (e: ChordMetricSample) => number,
  tSeed: number,
  aimPoint: Point,
): ScoredCandidate | null => {
  const resphi = (3 - Math.sqrt(5)) / 2
  let a = 0
  let b = 1
  let x1 = a + resphi * (b - a)
  let x2 = b - resphi * (b - a)
  let e1 = evaluateAt(x1)
  let e2 = evaluateAt(x2)

  let winner: ScoredCandidate | null = null

  const consider = (t: number) => {
    const e = evaluateAt(t)

    if (!e) {
      return
    }

    const m = score(e)
    winner = pickBetterCandidate(winner, t, e, m, aimPoint, tSeed)
  }

  consider(0)
  consider(1)
  consider(tSeed)

  for (let i = 0; i < GOLDEN_ITERS; i += 1) {
    consider(x1)
    consider(x2)

    const s1 = e1 ? score(e1) : Infinity
    const s2 = e2 ? score(e2) : Infinity

    if (s1 < s2) {
      b = x2
      x2 = x1
      e2 = e1
      x1 = a + resphi * (b - a)
      e1 = evaluateAt(x1)
    } else {
      a = x1
      x1 = x2
      e1 = e2
      x2 = b - resphi * (b - a)
      e2 = evaluateAt(x2)
    }
  }

  consider(x1)
  consider(x2)

  return winner
}

const gridSamples = (tSeed: number): number[] => {
  const out: number[] = []

  for (let i = 0; i <= GRID_STEPS; i += 1) {
    out.push(i / GRID_STEPS)
  }

  out.push(clamp01(tSeed))

  return [...new Set(out)].sort((u, v) => u - v)
}

/**
 * Even split: only moves the second endpoint along the legal sub-segment where the
 * user placed it. When `area0 − area1` changes sign along that edge, bisection finds an
 * exact 50/50 split; otherwise golden-section search minimizes imbalance on [0, 1].
 */
export const optimizeEvenSplitEndpoints = (
  start: SnappedPoint,
  currentEnd: SnappedPoint,
  lines: Line[],
  areas: Area[],
): SnappedPoint => {
  const legalSegments = buildLegalLineSegments(lines, areas)
  const L2 = resolveSegmentForEnd(legalSegments, currentEnd)

  if (!L2) {
    return currentEnd
  }

  const evalAt = makeEvalAt(start, currentEnd.lineId, L2, lines, areas)
  const tSeed = projectPointToSegmentT(L2, currentEnd.point)
  const aim = currentEnd.point

  let winner: ScoredCandidate | null = null

  const consider = (t: number) => {
    const e = evalAt(t)

    if (!e) {
      return
    }

    const m = imbalanceOf(e)
    winner = pickBetterCandidate(winner, t, e, m, aim, tSeed)
  }

  const ts = gridSamples(tSeed)

  for (let i = 0; i < ts.length; i += 1) {
    consider(ts[i])
  }

  for (let i = 0; i < ts.length - 1; i += 1) {
    const tA = ts[i]
    const tB = ts[i + 1]
    const eA = evalAt(tA)
    const eB = evalAt(tB)

    if (!eA || !eB) {
      continue
    }

    const dA = eA.a0 - eA.a1
    const dB = eB.a0 - eB.a1

    if (dA * dB > 0) {
      continue
    }

    const rootT = bisectRoot(evalAt, tA, tB, (e) => e.a0 - e.a1)

    if (rootT === null) {
      continue
    }

    const eRoot = evalAt(rootT)

    if (!eRoot) {
      continue
    }

    const m = imbalanceOf(eRoot)
    winner = pickBetterCandidate(winner, rootT, eRoot, m, aim, tSeed)
  }

  if (winner !== null && winner.metric < AREA_ROOT_TOL * 10) {
    return winner.end
  }

  const golden = goldenSectionMinimize(evalAt, imbalanceOf, tSeed, aim)

  if (golden !== null) {
    const merged = winner === null ? golden : pickBetterCandidate(winner, golden.t, {
      end: golden.end,
      a0: golden.a0,
      a1: golden.a1,
    }, golden.metric, aim, tSeed)

    return merged.end
  }

  return winner !== null ? winner.end : currentEnd
}

/**
 * Split 5: same edge constraint as even split. Bisects when `a0 − 5` or `a1 − 5`
 * brackets zero on the grid; otherwise minimizes distance to a 5-point fragment.
 */
export const optimizeSplitFiveEndpoints = (
  start: SnappedPoint,
  currentEnd: SnappedPoint,
  lines: Line[],
  areas: Area[],
): SnappedPoint => {
  const legalSegments = buildLegalLineSegments(lines, areas)
  const L2 = resolveSegmentForEnd(legalSegments, currentEnd)

  if (!L2) {
    return currentEnd
  }

  const evalAt = makeEvalAt(start, currentEnd.lineId, L2, lines, areas)
  const tSeed = projectPointToSegmentT(L2, currentEnd.point)
  const aim = currentEnd.point

  let winner: ScoredCandidate | null = null

  const consider = (t: number) => {
    const e = evalAt(t)

    if (!e) {
      return
    }

    const m = splitFiveScoreOf(e)
    winner = pickBetterCandidate(winner, t, e, m, aim, tSeed)
  }

  const ts = gridSamples(tSeed)

  for (let i = 0; i < ts.length; i += 1) {
    consider(ts[i])
  }

  for (let i = 0; i < ts.length - 1; i += 1) {
    const tA = ts[i]
    const tB = ts[i + 1]

    const valueFns = [
      (e: ChordMetricSample) => e.a0 - SPLIT_TARGET,
      (e: ChordMetricSample) => e.a1 - SPLIT_TARGET,
    ] as const

    for (const value of valueFns) {
      const eA = evalAt(tA)
      const eB = evalAt(tB)

      if (!eA || !eB) {
        continue
      }

      const vA = value(eA)
      const vB = value(eB)

      if (vA * vB > 0) {
        continue
      }

      const rootT = bisectRoot(evalAt, tA, tB, value)

      if (rootT === null) {
        continue
      }

      const eRoot = evalAt(rootT)

      if (!eRoot) {
        continue
      }

      const m = splitFiveScoreOf(eRoot)
      winner = pickBetterCandidate(winner, rootT, eRoot, m, aim, tSeed)
    }
  }

  if (winner !== null && winner.metric < AREA_ROOT_TOL * 100) {
    return winner.end
  }

  const golden = goldenSectionMinimize(evalAt, splitFiveScoreOf, tSeed, aim)

  if (golden !== null) {
    const merged =
      winner === null
        ? golden
        : pickBetterCandidate(winner, golden.t, { end: golden.end, a0: golden.a0, a1: golden.a1 }, golden.metric, aim, tSeed)

    return merged.end
  }

  return winner !== null ? winner.end : currentEnd
}
