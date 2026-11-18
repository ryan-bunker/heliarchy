/**
 * Core deterministic procedural galaxy engine.
 *
 * Designed for 1-to-1 portability to Rust/Wasm:
 * - All seeds and object IDs are unsigned 64-bit integers (`bigint` masked to 64 bits).
 * - All global coordinates are signed 128-bit integers (`bigint`) in exact 1-meter resolution.
 * - Spatial hashing is O(1) per 1 ly x 1 ly cell.
 */

export const GALAXY_SEED = 0x514e_4755_4c41_5254n; // "SINGULART"
export const METERS_PER_LIGHT_YEAR = 9_460_730_472_580_800n; // Exact Julian light-year in meters
export const METERS_PER_AU = 149_597_870_700n; // Exact IAU Astronomical Unit in meters
export const CELL_SIZE_METERS = METERS_PER_LIGHT_YEAR; // 1 cell = 1 ly x 1 ly
export const GALAXY_RADIUS_LY = 50_000; // 100,000 ly diameter

// Bit-packing layout for 64-bit Object ID:
// [63..46] (18 bits): Cell X + 131072 (range: -131,072 .. +131,071 ly)
// [45..28] (18 bits): Cell Y + 131072 (range: -131,072 .. +131,071 ly)
// [27..12] (16 bits): Star Index within cell (0 .. 65,535)
// [11..4]  (8 bits):  Planet Index (0 = Star itself, 1..255 = Planet 1..255)
// [3..0]   (4 bits):  Moon/Station Index (0 = Planet itself, 1..15 = Sub-body)
const CELL_OFFSET = 131_072n;
const MASK_18 = 0x3ffffn;
const MASK_16 = 0xffffn;
const MASK_8 = 0xffn;
const MASK_4 = 0xfn;
const MASK_64 = 0xffff_ffff_ffff_ffffn;

export interface UnpackedId {
  cellX: number;
  cellY: number;
  starIndex: number;
  planetIndex: number; // 0 = Star
  moonIndex: number;
}

export function packId(
  cellX: number,
  cellY: number,
  starIndex: number,
  planetIndex = 0,
  moonIndex = 0,
): bigint {
  const cx = BigInt(cellX) + CELL_OFFSET;
  const cy = BigInt(cellY) + CELL_OFFSET;
  const sIdx = BigInt(starIndex) & MASK_16;
  const pIdx = BigInt(planetIndex) & MASK_8;
  const mIdx = BigInt(moonIndex) & MASK_4;

  return (
    ((cx & MASK_18) << 46n) |
    ((cy & MASK_18) << 28n) |
    (sIdx << 12n) |
    (pIdx << 4n) |
    mIdx
  );
}

export function unpackId(id: bigint): UnpackedId {
  const clean = id & MASK_64;
  const cx = Number((clean >> 46n) & MASK_18) - Number(CELL_OFFSET);
  const cy = Number((clean >> 28n) & MASK_18) - Number(CELL_OFFSET);
  const starIndex = Number((clean >> 12n) & MASK_16);
  const planetIndex = Number((clean >> 4n) & MASK_8);
  const moonIndex = Number(clean & MASK_4);
  return { cellX: cx, cellY: cy, starIndex, planetIndex, moonIndex };
}

export function formatId(id: bigint): string {
  const hex = (id & MASK_64).toString(16).toUpperCase().padStart(16, "0");
  return `0x${hex.slice(0, 4)}_${hex.slice(4, 8)}_${hex.slice(8, 12)}_${hex.slice(12, 16)}`;
}

export function parseId(input: string): bigint | null {
  const cleaned = input.trim().replace(/^0x/i, "").replace(/_/g, "");
  if (!/^[0-9a-fA-F]{1,16}$/.test(cleaned)) return null;
  return BigInt("0x" + cleaned) & MASK_64;
}

/**
 * SplitMix64 deterministic 64-bit PRNG / Hash function.
 * Identical bit-level output to Rust `u64` wrapping arithmetic.
 */
export function splitmix64(state: bigint): bigint {
  let z = (state + 0x9e37_79b9_7f4a_7c15n) & MASK_64;
  z = ((z ^ (z >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK_64;
  return (z ^ (z >> 31n)) & MASK_64;
}

export function hashCoords(seed: bigint, cx: number, cy: number, extra = 0): bigint {
  const bx = BigInt.asUintN(64, BigInt(cx));
  const by = BigInt.asUintN(64, BigInt(cy));
  const be = BigInt.asUintN(64, BigInt(extra));
  const h1 = splitmix64(seed ^ bx);
  const h2 = splitmix64(h1 ^ (by << 1n));
  return splitmix64(h2 ^ be);
}

/**
 * Deterministic PRNG stream backed by SplitMix64.
 */
export class DetRng {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = seed & MASK_64;
  }

  nextU64(): bigint {
    this.state = (this.state + 0x9e37_79b9_7f4a_7c15n) & MASK_64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK_64;
    z = ((z ^ (z >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK_64;
    return (z ^ (z >> 31n)) & MASK_64;
  }

  /** Returns a float in [0, 1) with 53-bit precision */
  nextF64(): number {
    const u = this.nextU64() >> 11n;
    return Number(u) / 9007199254740992; // 2^53
  }

  /** Integer in [min, max] inclusive */
  nextRangeInt(min: number, max: number): number {
    if (max <= min) return min;
    const span = BigInt(max - min + 1);
    return min + Number(this.nextU64() % span);
  }
}

export type SpectralClass = "O" | "B" | "A" | "F" | "G" | "K" | "M";

export interface StarData {
  id: bigint;
  name: string;
  cellX: number;
  cellY: number;
  starIndex: number;
  /** Exact 1-meter global coordinates */
  xMeters: bigint;
  yMeters: bigint;
  spectralClass: SpectralClass;
  color: string;
  temperatureK: number;
  massSolar: number;
  radiusMeters: number;
  luminositySolar: number;
  planetCount: number;
}

export interface PlanetData {
  id: bigint;
  starId: bigint;
  name: string;
  planetIndex: number; // 1..N
  orbitRadiusMeters: bigint;
  orbitRadiusAU: number;
  orbitalPeriodSeconds: number;
  initialAngleRad: number;
  angularVelocityRadPerSec: number;
  radiusMeters: number;
  // Stars! style habitability traits
  gravityG: number; // 0.12g to 4.00g
  temperatureC: number; // -200C to +200C
  radiationMR: number; // 0mR to 100mR
  habitabilityPct: number; // -45% to +100% (Standard humanoid baseline)
  // Stars! style mineral concentrations (1% .. 100%) and surface deposits (kT)
  ironiumConc: number;
  boraniumConc: number;
  germaniumConc: number;
  surfaceIroniumKt: number;
  surfaceBoraniumKt: number;
  surfaceGermaniumKt: number;
}

const SYLLABLES_A = [
  "Al", "An", "Ar", "Bel", "Bet", "Can", "Cap", "Cas", "Cen", "Cy",
  "Den", "Dra", "Er", "Fom", "Gem", "Hyd", "Kae", "Kor", "Lyr", "Mir",
  "Nav", "Or", "Peg", "Per", "Pro", "Rig", "Sag", "Sir", "Sol", "Tau",
  "Vae", "Veg", "Vor", "Xan", "Zet", "Zor",
];
const SYLLABLES_B = [
  "cor", "da", "de", "don", "el", "en", "gar", "get", "gni", "ion",
  "is", "kaa", "la", "lon", "ma", "men", "mir", "na", "ach", "on",
  "or", "pha", "pux", "ra", "ri", "rus", "sa", "tar", "th", "ul",
  "ur", "us", "va", "ven", "vor", "x",
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/**
 * Calculates the expected stellar density (average stars per 1 ly x 1 ly cell)
 * at cell coordinates (cx, cy).
 *
 * Uses polar coordinates (r, theta) locally for the barred 4-arm logarithmic spiral,
 * while keeping the world grid strictly Cartesian.
 */
export function getStellarDensityLambda(cx: number, cy: number): number {
  const r = Math.hypot(cx, cy);
  if (r > GALAXY_RADIUS_LY * 1.15) return 0;

  const theta = Math.atan2(cy, cx);

  // 1. Galactic core bulge (dense Gaussian + exponential core)
  const coreBulge = 4.5 * Math.exp(-Math.pow(r / 2800, 1.6));

  // 2. Exponential galactic disk falloff (tuned so Outer Spur at r~22,000 ly averages ~1 star per 25-30 sq ly, i.e. ~5 ly spacing)
  const diskProfile = 0.55 * Math.exp(-r / 12500);

  // 3. 4-Arm Logarithmic Spiral wave
  const armCount = 4;
  const windingB = 0.28; // Tightness of spiral
  const logR = Math.log(Math.max(r, 400) / 1000);
  const phase = armCount * (theta - logR / windingB);
  // Sharp crests along the spiral arms
  const primaryArm = Math.pow((Math.cos(phase) + 1) * 0.5, 2.8);
  // Secondary spurs
  const spurPhase = 2 * (theta - logR / (windingB * 0.85)) + 1.1;
  const spurArm = 0.35 * Math.pow((Math.cos(spurPhase) + 1) * 0.5, 3.0);

  // Smooth transition from central bar/bulge to spiral arms
  const armWeight = Math.min(1, r / 3500);
  const armModulation = (1 - armWeight) * 0.6 + armWeight * (0.05 + 1.25 * (primaryArm + spurArm));

  // Edge taper near 50,000 ly
  const edgeTaper = r > 42000 ? Math.max(0, 1 - (r - 42000) / 10000) : 1;

  return Math.max(0, (coreBulge + diskProfile * armModulation) * edgeTaper);
}

/**
 * Inverse transform Poisson sampler: given expected rate lambda and a PRNG,
 * returns integer number of stars in this cell.
 */
function samplePoisson(lambda: number, rng: DetRng): number {
  if (lambda <= 0.0001) return 0;
  if (lambda > 18) {
    // Normal approximation for high core densities
    const u1 = Math.max(1e-9, rng.nextF64());
    const u2 = rng.nextF64();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1.0;
  do {
    k++;
    p *= rng.nextF64();
  } while (p > L && k < 64);
  return k - 1;
}

const SPECTRAL_TABLE: {
  cls: SpectralClass;
  weight: number;
  color: string;
  tempRange: [number, number];
  massRange: [number, number];
  radiusSolarRange: [number, number];
  lumRange: [number, number];
}[] = [
  { cls: "O", weight: 0.003, color: "#689dff", tempRange: [30000, 48000], massRange: [16, 60], radiusSolarRange: [6.6, 15], lumRange: [30000, 250000] },
  { cls: "B", weight: 0.015, color: "#92b5ff", tempRange: [10000, 30000], massRange: [2.1, 16], radiusSolarRange: [1.8, 6.6], lumRange: [25, 30000] },
  { cls: "A", weight: 0.04, color: "#d5e0ff", tempRange: [7500, 10000], massRange: [1.4, 2.1], radiusSolarRange: [1.4, 1.8], lumRange: [5, 25] },
  { cls: "F", weight: 0.08, color: "#f9f5ff", tempRange: [6000, 7500], massRange: [1.04, 1.4], radiusSolarRange: [1.15, 1.4], lumRange: [1.5, 5] },
  { cls: "G", weight: 0.14, color: "#fff2a1", tempRange: [5200, 6000], massRange: [0.8, 1.04], radiusSolarRange: [0.96, 1.15], lumRange: [0.6, 1.5] },
  { cls: "K", weight: 0.24, color: "#ffbe6f", tempRange: [3700, 5200], massRange: [0.45, 0.8], radiusSolarRange: [0.7, 0.96], lumRange: [0.08, 0.6] },
  { cls: "M", weight: 0.482, color: "#ff7b5a", tempRange: [2400, 3700], massRange: [0.08, 0.45], radiusSolarRange: [0.15, 0.7], lumRange: [0.001, 0.08] },
];

function generateStarFromIndex(cellX: number, cellY: number, starIndex: number): StarData {
  const starSeed = hashCoords(GALAXY_SEED, cellX, cellY, starIndex + 1);
  const rng = new DetRng(starSeed);
  const id = packId(cellX, cellY, starIndex, 0, 0);

  // 1-meter local offset inside the 1-light-year cell (keep 2% margin from cell boundaries)
  const margin = CELL_SIZE_METERS / 50n;
  const usableSpan = CELL_SIZE_METERS - margin * 2n;
  const localX = margin + (rng.nextU64() % usableSpan);
  const localY = margin + (rng.nextU64() % usableSpan);

  const xMeters = BigInt(cellX) * CELL_SIZE_METERS + localX;
  const yMeters = BigInt(cellY) * CELL_SIZE_METERS + localY;

  // Spectral class roll
  const roll = rng.nextF64();
  let accum = 0;
  let spec = SPECTRAL_TABLE[SPECTRAL_TABLE.length - 1];
  for (const entry of SPECTRAL_TABLE) {
    accum += entry.weight;
    if (roll <= accum) {
      spec = entry;
      break;
    }
  }

  const t = rng.nextF64();
  const temperatureK = Math.round(spec.tempRange[0] + t * (spec.tempRange[1] - spec.tempRange[0]));
  const massSolar = Number((spec.massRange[0] + t * (spec.massRange[1] - spec.massRange[0])).toFixed(2));
  const radiusSolar = spec.radiusSolarRange[0] + t * (spec.radiusSolarRange[1] - spec.radiusSolarRange[0]);
  const radiusMeters = Math.round(radiusSolar * 696_340_000);
  const luminositySolar = Number((spec.lumRange[0] + Math.pow(t, 2) * (spec.lumRange[1] - spec.lumRange[0])).toFixed(3));

  const sylA = SYLLABLES_A[rng.nextRangeInt(0, SYLLABLES_A.length - 1)];
  const sylB = SYLLABLES_B[rng.nextRangeInt(0, SYLLABLES_B.length - 1)];
  const numSuffix = rng.nextRangeInt(10, 999);
  const name = `${sylA}${sylB}-${numSuffix}`;

  const planetCount = rng.nextRangeInt(1, 6);

  return {
    id,
    name,
    cellX,
    cellY,
    starIndex,
    xMeters,
    yMeters,
    spectralClass: spec.cls,
    color: spec.color,
    temperatureK,
    massSolar,
    radiusMeters,
    luminositySolar,
    planetCount,
  };
}

// LRU cache for cell stars so panning is instantaneous
const cellCache = new Map<string, StarData[]>();
const MAX_CACHE_CELLS = 32000;

export function getCellStars(cellX: number, cellY: number): StarData[] {
  const key = `${cellX},${cellY}`;
  const cached = cellCache.get(key);
  if (cached) return cached;

  const lambda = getStellarDensityLambda(cellX, cellY);
  if (lambda <= 0) return [];

  const cellSeed = hashCoords(GALAXY_SEED, cellX, cellY, 0);
  const rng = new DetRng(cellSeed);
  const count = samplePoisson(lambda, rng);

  const stars: StarData[] = [];
  for (let i = 0; i < count; i++) {
    stars.push(generateStarFromIndex(cellX, cellY, i));
  }

  if (cellCache.size >= MAX_CACHE_CELLS) {
    const oldestKey = cellCache.keys().next().value;
    if (oldestKey !== undefined) cellCache.delete(oldestKey);
  }
  cellCache.set(key, stars);
  return stars;
}

export function getStarById(starId: bigint): StarData | null {
  const { cellX, cellY, starIndex } = unpackId(starId);
  const cellStars = getCellStars(cellX, cellY);
  if (starIndex >= 0 && starIndex < cellStars.length) {
    return cellStars[starIndex];
  }
  // Even if starIndex exceeds normal Poisson count (e.g. direct synthetic ID),
  // we can still deterministically generate it if within bounds:
  return null;
}

/**
 * Generates all orbiting planets for a star deterministically from its ID.
 */
export function getPlanetsForStar(star: StarData): PlanetData[] {
  const planets: PlanetData[] = [];
  // Titius-Bode style progression in AU
  let currentAu = 0.28 + (Number(star.id & 0xffn) / 255) * 0.25;

  for (let pIdx = 1; pIdx <= star.planetCount; pIdx++) {
    const planetId = packId(star.cellX, star.cellY, star.starIndex, pIdx, 0);
    const rng = new DetRng(splitmix64(planetId ^ GALAXY_SEED));

    if (pIdx > 1) {
      currentAu *= 1.42 + rng.nextF64() * 0.45;
    }
    const orbitRadiusAU = Number(currentAu.toFixed(3));
    const orbitRadiusMeters = BigInt(Math.round(currentAu * Number(METERS_PER_AU)));

    // Kepler's Third Law: T = 2*pi * sqrt(a^3 / (G * M))
    // In Earth years: T_years = sqrt(a_AU^3 / M_solar)
    // Note: For visual feedback in Tactical View, real-time Kepler orbital velocity
    // at 0.4 AU is ~47,000 meters/second! At 1m/px zoom you can literally watch the
    // planet race across hundreds of meters per frame in real physical time!
    const periodYears = Math.sqrt(Math.pow(currentAu, 3) / Math.max(0.08, star.massSolar));
    const orbitalPeriodSeconds = Math.max(86400, periodYears * 31_557_600);
    const angularVelocityRadPerSec = (2 * Math.PI) / orbitalPeriodSeconds;
    const initialAngleRad = rng.nextF64() * Math.PI * 2;

    const radiusMeters = rng.nextRangeInt(2_100_000, 14_500_000);

    // Classic Stars! 1..99 click environment system modeled on the standard "Humanoid (Jack of All Trades)" race:
    // - Habitable range on each axis is click 15..85 (center 50, half-width 35 -> 71% pass rate per axis).
    // - Combined green planet probability: 0.71 * 0.71 * 0.71 ≈ 35.8% (~1 in 3 planets are naturally green!).
    const gClick = rng.nextRangeInt(1, 99);
    // Slight orbital distance bias on temperature (inner orbits warmer, outer orbits cooler, centered around click 50)
    const orbitBiasClicks = Math.round((2.5 - pIdx) * 6);
    const tClick = Math.max(1, Math.min(99, rng.nextRangeInt(5, 95) + orbitBiasClicks));
    const rClick = rng.nextRangeInt(1, 99);

    // Map 1..99 clicks to display units (0.12g..4.40g+, -200C..+200C, 1mR..99mR)
    const gravityG =
      gClick <= 50
        ? Number((0.12 + ((gClick - 1) / 49) * 0.88).toFixed(2))
        : Number((1.0 + Math.pow((gClick - 50) / 49, 1.5) * 4.5).toFixed(2));
    const temperatureC = Math.round(((tClick - 50) / 49) * 200);
    const radiationMR = rClick;

    // Stars! Humanoid habitability calculation (Ideal click = 50, immune/habitable band = 15..85, half-width = 35)
    const gOver = Math.max(0, Math.abs(gClick - 50) - 35);
    const tOver = Math.max(0, Math.abs(tClick - 50) - 35);
    const rOver = Math.max(0, Math.abs(rClick - 50) - 35);

    let habitabilityPct: number;
    if (gOver > 0 || tOver > 0 || rOver > 0) {
      // Negative habitability is the sum of clicks outside the race's tolerance band (capped at -45%)
      habitabilityPct = -Math.min(45, gOver + tOver + rOver);
    } else {
      const dg = Math.abs(gClick - 50) / 35;
      const dt = Math.abs(tClick - 50) / 35;
      const dr = Math.abs(rClick - 50) / 35;
      // Stars! quadratic distance-from-ideal formula
      const rms = Math.sqrt(((1 - dg * dg) + (1 - dt * dt) + (1 - dr * dr)) / 3);
      const penalty = (1 - dg * 0.35) * (1 - dt * 0.35) * (1 - dr * 0.35);
      habitabilityPct = Math.max(1, Math.min(100, Math.round(100 * rms * penalty)));
    }

    const ironiumConc = rng.nextRangeInt(8, 98);
    const boraniumConc = rng.nextRangeInt(5, 95);
    const germaniumConc = rng.nextRangeInt(10, 96);

    const surfaceIroniumKt = rng.nextRangeInt(50, 900);
    const surfaceBoraniumKt = rng.nextRangeInt(30, 750);
    const surfaceGermaniumKt = rng.nextRangeInt(40, 800);

    planets.push({
      id: planetId,
      starId: star.id,
      name: `${star.name} ${ROMAN[pIdx - 1] ?? pIdx}`,
      planetIndex: pIdx,
      orbitRadiusMeters,
      orbitRadiusAU,
      orbitalPeriodSeconds,
      initialAngleRad,
      angularVelocityRadPerSec,
      radiusMeters,
      gravityG,
      temperatureC,
      radiationMR,
      habitabilityPct,
      ironiumConc,
      boraniumConc,
      germaniumConc,
      surfaceIroniumKt,
      surfaceBoraniumKt,
      surfaceGermaniumKt,
    });
  }

  return planets;
}

/**
 * Computes a planet's exact 1-meter global coordinates at timestamp `nowMs`.
 *
 * Notice that the orbital offset is added in 128-bit integer space (`bigint`)
 * to the parent star's 1-meter coordinates, preserving 1m precision anywhere in the galaxy.
 */
export function getPlanetPositionMeters(
  star: StarData,
  planet: PlanetData,
  nowMs: number,
  timeScale = 1,
): { xMeters: bigint; yMeters: bigint; angleRad: number; orbitalSpeedMetersPerSec: number } {
  const tSeconds = (nowMs / 1000) * timeScale;
  const angleRad = planet.initialAngleRad + planet.angularVelocityRadPerSec * tSeconds;
  const rMeters = Number(planet.orbitRadiusMeters);

  const dxMeters = BigInt(Math.round(rMeters * Math.cos(angleRad)));
  const dyMeters = BigInt(Math.round(rMeters * Math.sin(angleRad)));

  const orbitalSpeedMetersPerSec = Math.round(rMeters * planet.angularVelocityRadPerSec * timeScale);

  return {
    xMeters: star.xMeters + dxMeters,
    yMeters: star.yMeters + dyMeters,
    angleRad,
    orbitalSpeedMetersPerSec,
  };
}

const superBlockCache = new Map<string, StarData[]>();
const MAX_SUPERBLOCK_CACHE = 16000;

/**
 * Quadtree / Super-Block Importance Sampler for intermediate and wide zoom levels.
 *
 * For a block of size `stride x stride` light-years (where stride = 2, 4, 8, 16, 32, 64, 128, 256, 512):
 * Evaluates in O(1) time by deterministically sampling 1..3 actual 1-ly cells inside the block
 * and returning their brightest star(s). Because it pulls from `getCellStars(cx, cy)`, every star
 * rendered at any zoom level is a real, clickable star with a valid 64-bit ID and planets.
 */
export function getSuperBlockStars(blockX: number, blockY: number, stride: number): StarData[] {
  if (stride <= 1) {
    return getCellStars(blockX, blockY);
  }

  const key = `${stride}:${blockX},${blockY}`;
  const cached = superBlockCache.get(key);
  if (cached) return cached;

  const centerCx = blockX * stride + (stride >> 1);
  const centerCy = blockY * stride + (stride >> 1);
  const lambda = getStellarDensityLambda(centerCx, centerCy);
  if (lambda <= 0.002) return [];

  const seed = hashCoords(GALAXY_SEED ^ 0x55aa55aan, blockX, blockY, stride);
  const rng = new DetRng(seed);

  // Expected representative stars per super-block (1 to 3 depending on galactic density)
  const effectiveLambda = lambda * Math.min(8, Math.sqrt(stride));
  const sampleCount = Math.min(3, samplePoisson(Math.min(2.6, effectiveLambda * 0.9 + 0.15), rng));
  const out: StarData[] = [];
  const usedCells = new Set<string>();

  for (let attempt = 0; attempt < sampleCount * 6 && out.length < sampleCount; attempt++) {
    const scx = blockX * stride + rng.nextRangeInt(0, stride - 1);
    const scy = blockY * stride + rng.nextRangeInt(0, stride - 1);
    const cKey = `${scx},${scy}`;
    if (usedCells.has(cKey)) continue;
    usedCells.add(cKey);

    const cellStars = getCellStars(scx, scy);
    if (cellStars.length > 0) {
      // Pick the highest-luminosity star in that cell as the landmark representative
      let brightest = cellStars[0];
      for (let j = 1; j < cellStars.length; j++) {
        if (cellStars[j].luminositySolar > brightest.luminositySolar) {
          brightest = cellStars[j];
        }
      }
      out.push(brightest);
    }
  }

  if (superBlockCache.size >= MAX_SUPERBLOCK_CACHE) {
    const oldest = superBlockCache.keys().next().value;
    if (oldest !== undefined) superBlockCache.delete(oldest);
  }
  superBlockCache.set(key, out);
  return out;
}
