/**
 * Small, local paper-surface primitives for the sketch nodes.
 *
 * G's canvas renderer accepts a Pattern object whose image can be a data URL.
 * Keeping the tile as an inline SVG means the fibers do not depend on a
 * browser canvas, a network request, or another asset bundle. The tile is
 * generated once per seed and reused by every path that shares that seed.
 */

const patternCache = new Map();
const PATTERN_CACHE_LIMIT = 160;
const TILE_SIZE = 64;

function randomStream(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function compactNumber(value) {
  return Number(value.toFixed(2));
}

function fiberPath(random, index) {
  const x = random() * TILE_SIZE;
  const y = random() * TILE_SIZE;
  const length = 7 + random() * 20;
  const tilt = (random() - 0.5) * 0.6;
  const rise = (random() - 0.5) * 5.5;
  const endX = x + length;
  const endY = y + rise + tilt * length;
  const controlX = x + length * (0.35 + random() * 0.25);
  const controlY = y + rise * 0.55 + (random() - 0.5) * 2.5;
  const tone = index % 4 === 0 ? '#f8f8f6' : '#596166';
  const opacity = index % 4 === 0 ? 0.22 : 0.16;
  const width = index % 5 === 0 ? 0.75 : 0.55;
  return `<path d="M${compactNumber(x)} ${compactNumber(y)} Q${compactNumber(controlX)} ${compactNumber(controlY)} ${compactNumber(endX)} ${compactNumber(endY)}" stroke="${tone}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;
}

function fleck(random, index) {
  const x = random() * TILE_SIZE;
  const y = random() * TILE_SIZE;
  const radius = 0.25 + random() * 0.6;
  const tone = index % 3 === 0 ? '#f7f7f5' : '#4f585c';
  const opacity = index % 3 === 0 ? 0.24 : 0.18;
  return `<circle cx="${compactNumber(x)}" cy="${compactNumber(y)}" r="${compactNumber(radius)}" fill="${tone}" fill-opacity="${opacity}"/>`;
}

function textureSource(seed) {
  const random = randomStream(seed);
  const fibers = Array.from({ length: 18 }, (_, index) => fiberPath(random, index)).join('');
  const flecks = Array.from({ length: 34 }, (_, index) => fleck(random, index)).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}"><g>${fibers}${flecks}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Return a cached G Pattern containing neutral gray fibers and tiny flecks.
 * The pattern is transparent outside the marks, so the node's paper fill
 * remains the source of its neutral gray tone.
 */
export function paperTexturePattern(seed) {
  const key = Number(seed) >>> 0;
  const cached = patternCache.get(key);
  if (cached) return cached;
  const pattern = { image: textureSource(key), repetition: 'repeat' };
  patternCache.set(key, pattern);
  if (patternCache.size > PATTERN_CACHE_LIMIT) patternCache.delete(patternCache.keys().next().value);
  return pattern;
}

export const paperTextureTileSize = TILE_SIZE;
