import {
  CELL_SIZE_METERS,
  formatId,
  getCellStars,
  getPlanetPositionMeters,
  getPlanetsForStar,
  getStarById,
  METERS_PER_LIGHT_YEAR,
  parseId,
  PlanetData,
  StarData,
  unpackId,
} from "./galaxy";

const STORAGE_KEY = "heliarchy_sandbox_state_v5";

/**
 * 1 Stars! Game Year (Turn) = 15.0 Simulation Minutes at 1x Persistent MMO speed.
 * Synchronizes economic output (resources, mining, pop growth) with interstellar ship travel times!
 */
export const SIM_MINUTES_PER_GAME_YEAR = 15.0;

/** Speed of radio/subspace telemetry returning from probes to your nearest colony (in ly / sim minute) */
export const SIGNAL_SPEED_LY_PER_MIN = 1.7;

export type OwnerFaction = "Player" | "Xenon";

export type BuildableType =
  | "mine"
  | "factory"
  | "starbase"
  | "scout"
  | "colony"
  | "freighter"
  | "destroyer";

export interface BuildCost {
  type: BuildableType;
  label: string;
  category: "structure" | "ship";
  resources: number;
  ironium: number;
  boranium: number;
  germanium: number;
  description: string;
}

export const BUILD_CATALOG: Record<BuildableType, BuildCost> = {
  mine: {
    type: "mine",
    label: "Mine",
    category: "structure",
    resources: 5,
    ironium: 0,
    boranium: 0,
    germanium: 0,
    description: "Costs 5 Resources (0 Minerals). Requires 1,000 colonists per Mine to operate.",
  },
  factory: {
    type: "factory",
    label: "Factory",
    category: "structure",
    resources: 10,
    ironium: 0,
    boranium: 0,
    germanium: 4,
    description: "Costs 10 Res + 4kT Germanium. +1 Res/min. Requires 1,000 colonists to operate.",
  },
  starbase: {
    type: "starbase",
    label: "Orbital Starbase",
    category: "structure",
    resources: 100,
    ironium: 32,
    boranium: 24,
    germanium: 28,
    description: "Unlocks ship construction, instant refueling & 1.8 ly radar.",
  },
  scout: {
    type: "scout",
    label: "Scout Probe",
    category: "ship",
    resources: 18,
    ironium: 5,
    boranium: 1,
    germanium: 3,
    description: "Low-mass probe. High delta-v for multi-star gravity-assist tours.",
  },
  colony: {
    type: "colony",
    label: "Colony Ship",
    category: "ship",
    resources: 44,
    ironium: 14,
    boranium: 8,
    germanium: 10,
    description: "Heavy ark carrying 25,000 colonists to establish a new colony.",
  },
  freighter: {
    type: "freighter",
    label: "Medium Freighter",
    category: "ship",
    resources: 32,
    ironium: 12,
    boranium: 3,
    germanium: 6,
    description: "Hauls up to 300 kT of minerals or 50,000 colonists between worlds.",
  },
  destroyer: {
    type: "destroyer",
    label: "Destroyer",
    category: "ship",
    resources: 70,
    ironium: 26,
    boranium: 18,
    germanium: 14,
    description: "Armed warship. Engages hostile fleets & captures enemy colonies.",
  },
};

export const MAX_QUEUE_ITEM_COUNT = 60;

export interface BuildQueueItem {
  type: BuildableType;
  count: number;
  /** Number of units completed in the current auto-repeat batch before rotating to bottom */
  batchBuilt?: number;
  progressResources: number;
  /** If true, repeats in batches of `count` and rotates to the bottom of the queue */
  autoRepeat?: boolean;
  /** For autoRepeat mines/factories: fixed cap (1..60) or "operable" worker cap */
  autoCap?: number | "operable";
}

export interface PlanetDelta {
  planetIdHex: string;
  customName?: string;
  owner: OwnerFaction;
  homeworldBoost?: boolean;
  sisterWorldBoost?: boolean;
  mines: number;
  factories: number;
  hasStarbase: boolean;
  buildQueue: BuildQueueItem[];
  populationAtCheckpoint: number;
  surfaceIroniumKtAtCheckpoint: number;
  surfaceBoraniumKtAtCheckpoint: number;
  surfaceGermaniumKtAtCheckpoint: number;
  colonizedAtSimMs: number;
  lastCheckpointSimMs: number;
}

export interface ShipCounts {
  scout: number;
  colony: number;
  freighter: number;
  destroyer: number;
}

export interface CargoManifest {
  ironium: number;
  boranium: number;
  germanium: number;
  colonists: number;
}

export type BurnMode = "orbit" | "flyby";

export interface RouteLegSummary {
  legIndex: number;
  fromX: bigint;
  fromY: bigint;
  toX: bigint;
  toY: bigint;
  targetId: bigint;
  targetName: string;
  distLy: number;
  deflectionDeg: number;
  accelOrTcmFuelPct: number;
  brakeFuelPct: number;
  legTotalFuelPct: number;
  maneuverLabel: string;
}

export interface RoutePlanSummary {
  legs: RouteLegSummary[];
  totalFuelRequiredPct: number;
  remainingFuelAfterPct: number;
  totalEtaSimSeconds: number;
  totalEtaGameYears: number;
  canAffordFuel: boolean;
}

export interface Fleet {
  id: string;
  name: string;
  owner: OwnerFaction;
  ships: ShipCounts;
  cargo: CargoManifest;
  /** Reaction mass / delta-v fuel reserve (0..100%). Only expended on acceleration/slingshot/braking, NEVER while coasting! */
  fuelPct: number;
  /** Burn Intensity (1..10, like Stars! Warp 1..10). Higher burn = faster cruise velocity, exponentially higher fuel cost. */
  burnLevel: number;
  /** "orbit" = brake into orbit at final waypoint; "flyby" = 0% brake at final waypoint, coasts past */
  burnMode: BurnMode;
  /** Draft waypoints being planned in the UI before launch */
  plannedRoute?: bigint[];
  /** Active remaining gravity-assist waypoints after the current leg */
  queuedWaypoints?: bigint[];
  /** Count of stellar gravity-assist perihelion passes completed on this voyage (grants solar recharge) */
  slingshotsCompleted?: number;
  /** True once a deep-space probe's onboard power reserve hits 0% far from the empire */
  isDerelict?: boolean;
  orbitTargetId: bigint | null;
  originX: bigint;
  originY: bigint;
  destX: bigint;
  destY: bigint;
  destTargetId: bigint | null;
  departureSimMs: number;
  arrivalSimMs: number;
}

/**
 * Represents a finite-speed telemetry transmission traveling from a newly scanned star
 * back to the player's nearest Colony / Comms Receiver.
 */
export interface PendingSignal {
  starIdHex: string;
  starName: string;
  sourceX: bigint;
  sourceY: bigint;
  receiverX: bigint;
  receiverY: bigint;
  emittedSimMs: number;
  arrivalSimMs: number;
}

export interface EvaluatedPlanetState {
  isModified: boolean;
  owner: OwnerFaction | null;
  displayName: string;
  effectiveHabitabilityPct: number;
  mines: number;
  operableMines: number;
  factories: number;
  operableFactories: number;
  workerCapStructures: number;
  maxPlanetStructures: number;
  hasStarbase: boolean;
  buildQueue: BuildQueueItem[];
  population: number;
  maxPopulation: number;
  populationGrowthPerMin: number;
  resourcesPerMin: number;
  surfaceIroniumKt: number;
  surfaceBoraniumKt: number;
  surfaceGermaniumKt: number;
  ironiumMiningRatePerMin: number;
  boraniumMiningRatePerMin: number;
  germaniumMiningRatePerMin: number;
}

export interface CombatLogEntry {
  simTimeMs: number;
  realTimeMs?: number;
  gameYear?: number;
  message: string;
  type: "info" | "combat" | "colony";
}

interface PersistedSandboxState {
  simEpochBaseMs?: number;
  simClockBaseMs: number;
  lastRealTimestampMs: number;
  speedMultiplier: number;
  nextFleetSeq: number;
  deltas: PlanetDelta[];
  fleets: {
    id: string;
    name: string;
    owner: OwnerFaction;
    ships: ShipCounts;
    cargo: CargoManifest;
    fuelPct?: number;
    burnLevel?: number;
    burnMode?: BurnMode;
    plannedRouteHexes?: string[];
    queuedWaypointHexes?: string[];
    slingshotsCompleted?: number;
    isDerelict?: boolean;
    orbitTargetIdHex: string | null;
    originX: string;
    originY: string;
    destX: string;
    destY: string;
    destTargetIdHex: string | null;
    departureSimMs: number;
    arrivalSimMs: number;
  }[];
  scannedStarIdHexes: string[];
  pendingSignals?: {
    starIdHex: string;
    starName: string;
    sourceX: string;
    sourceY: string;
    receiverX: string;
    receiverY: string;
    emittedSimMs: number;
    arrivalSimMs: number;
  }[];
  logs: CombatLogEntry[];
}

class SandboxStore {
  private deltas = new Map<string, PlanetDelta>();
  private fleets = new Map<string, Fleet>();
  private scannedStars = new Set<string>();
  private pendingSignals = new Map<string, PendingSignal>();
  private logs: CombatLogEntry[] = [];

  private simEpochBaseMs = Date.now();
  private simClockBaseMs = this.simEpochBaseMs;
  private lastRealTimestampMs = this.simEpochBaseMs;
  private speedMultiplier = 15; // Default 15x Blitz for playtesting (1x = 30m/yr MMO pace)
  private nextFleetSeq = 1;

  constructor() {
    this.loadFromStorage();
  }

  getGameYear(simNowMs = this.getSimNowMs()): number {
    const elapsedMin = Math.max(0, (simNowMs - this.simEpochBaseMs) / 60_000);
    return 2400 + elapsedMin / SIM_MINUTES_PER_GAME_YEAR;
  }

  getSimNowMs(realNowMs = Date.now()): number {
    const realDelta = Math.max(0, realNowMs - this.lastRealTimestampMs);
    this.simClockBaseMs += realDelta * this.speedMultiplier;
    this.lastRealTimestampMs = realNowMs;
    return this.simClockBaseMs;
  }

  getSpeedMultiplier(): number {
    return this.speedMultiplier;
  }

  setSpeedMultiplier(mult: number, realNowMs = Date.now()): void {
    this.getSimNowMs(realNowMs);
    this.speedMultiplier = mult;
    this.saveToStorage();
  }

  getSimEpochBaseMs(): number {
    return this.simEpochBaseMs;
  }

  getLogs(): CombatLogEntry[] {
    return this.logs;
  }

  addLog(message: string, type: "info" | "combat" | "colony" = "info", simTimeMs = this.getSimNowMs()): void {
    const gameYear = Number(this.getGameYear(simTimeMs).toFixed(2));
    this.logs.unshift({
      simTimeMs,
      realTimeMs: Date.now(),
      gameYear,
      message,
      type,
    });
    if (this.logs.length > 100) this.logs.length = 100;
  }

  exportDebugTelemetry(): string {
    const simNowMs = this.getSimNowMs();
    const gameYear = Number(this.getGameYear(simNowMs).toFixed(2));
    const simElapsedMin = Number(((simNowMs - this.simEpochBaseMs) / 60_000).toFixed(2));

    const colonies = this.getAllDeltas()
      .filter(({ delta }) => delta.owner === "Player")
      .map(({ id, delta }) => {
        const star = getStarById(id);
        const { planetIndex } = unpackId(id);
        const planet = star ? getPlanetsForStar(star)[planetIndex - 1] : null;
        const evalState = planet ? this.evaluate(planet, simNowMs) : null;
        return {
          name: delta.customName || planet?.name || delta.planetIdHex,
          population: evalState?.population ?? delta.populationAtCheckpoint,
          mines: `${evalState?.operableMines ?? delta.mines}/${delta.mines}`,
          factories: `${evalState?.operableFactories ?? delta.factories}/${delta.factories}`,
          resPerMin: evalState?.resourcesPerMin ?? 0,
          resPerYear: evalState ? Number((evalState.resourcesPerMin * SIM_MINUTES_PER_GAME_YEAR).toFixed(1)) : 0,
          mineralsKt: {
            ironium: evalState?.surfaceIroniumKt ?? delta.surfaceIroniumKtAtCheckpoint,
            boranium: evalState?.surfaceBoraniumKt ?? delta.surfaceBoraniumKtAtCheckpoint,
            germanium: evalState?.surfaceGermaniumKt ?? delta.surfaceGermaniumKtAtCheckpoint,
          },
          buildQueue: delta.buildQueue,
        };
      });

    const fleets = this.getAllFleets()
      .filter((f) => f.owner === "Player")
      .map((f) => ({
        name: f.name,
        ships: f.ships,
        fuelPct: Math.round(f.fuelPct),
        burnLevel: f.burnLevel ?? 5,
        burnMode: f.burnMode,
        powerPct: this.getFleetPowerState(f, simNowMs).powerPct,
        inOrbit: f.orbitTargetId !== null,
      }));

    const events = this.logs.map((l) => {
      const yr = l.gameYear ?? Number(this.getGameYear(l.simTimeMs).toFixed(2));
      const simMin = Number(((l.simTimeMs - this.simEpochBaseMs) / 60_000).toFixed(2));
      return {
        gameYear: yr,
        simElapsedMin: simMin,
        realTimeIso: l.realTimeMs ? new Date(l.realTimeMs).toISOString() : null,
        type: l.type,
        message: l.message,
      };
    });

    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        pacing: {
          simMinutesPerGameYear: SIM_MINUTES_PER_GAME_YEAR,
          currentSpeedMultiplier: this.speedMultiplier,
          currentGameYear: gameYear,
          simElapsedMinutes: simElapsedMin,
          signalSpeedLyPerMin: SIGNAL_SPEED_LY_PER_MIN,
        },
        colonies,
        fleets,
        events,
      },
      null,
      2,
    );
  }

  private keyFor(id: bigint): string {
    return formatId(id);
  }

  private starKeyForObject(id: bigint): string {
    const { cellX, cellY, starIndex } = unpackId(id);
    const star = getCellStars(cellX, cellY)[starIndex];
    return star ? formatId(star.id) : formatId(id);
  }

  isStarScanned(starId: bigint): boolean {
    return this.scannedStars.has(formatId(starId));
  }

  getPendingSignal(starId: bigint): PendingSignal | undefined {
    return this.pendingSignals.get(formatId(starId));
  }

  getAllPendingSignals(): PendingSignal[] {
    return Array.from(this.pendingSignals.values());
  }

  /**
   * Queues a finite-speed telemetry transmission from `star` back to the nearest Player Colony.
   * Information travels at `SIGNAL_SPEED_LY_PER_MIN` rather than instantaneously!
   */
  private emitTelemetryFromStar(star: StarData, simNowMs: number): boolean {
    const key = formatId(star.id);
    if (this.scannedStars.has(key) || this.pendingSignals.has(key)) return false;

    // Find nearest Player Colony to receive the telemetry signal
    let bestReceiverX = star.xMeters;
    let bestReceiverY = star.yMeters;
    let minDistMeters = Infinity;

    for (const { id, delta } of this.getAllDeltas()) {
      if (delta.owner !== "Player") continue;
      const colStar = getStarById(id);
      if (!colStar) continue;
      const d = Math.hypot(
        Number(colStar.xMeters - star.xMeters),
        Number(colStar.yMeters - star.yMeters),
      );
      if (d < minDistMeters) {
        minDistMeters = d;
        bestReceiverX = colStar.xMeters;
        bestReceiverY = colStar.yMeters;
      }
    }

    const distLy = minDistMeters === Infinity ? 0 : minDistMeters / Number(METERS_PER_LIGHT_YEAR);
    if (distLy <= 0.25) {
      // Virtually same system -> immediate receipt
      this.scannedStars.add(key);
      this.addLog(`Scanned system ${star.name} (${star.planetCount} planets charted).`, "info", simNowMs);
      return true;
    }

    const signalDurationMs = Math.max(
      2_000,
      Math.round((distLy / SIGNAL_SPEED_LY_PER_MIN) * 60_000),
    );

    this.pendingSignals.set(key, {
      starIdHex: key,
      starName: star.name,
      sourceX: star.xMeters,
      sourceY: star.yMeters,
      receiverX: bestReceiverX,
      receiverY: bestReceiverY,
      emittedSimMs: simNowMs,
      arrivalSimMs: simNowMs + signalDurationMs,
    });

    this.addLog(
      `Probe scanning ${star.name} (${distLy.toFixed(1)} ly away) — telemetry signal in transit...`,
      "info",
      simNowMs,
    );
    return true;
  }

  initNewGame(homeStar: StarData): void {
    this.deltas.clear();
    this.fleets.clear();
    this.scannedStars.clear();
    this.pendingSignals.clear();
    this.logs = [];
    this.nextFleetSeq = 1;
    this.simEpochBaseMs = Date.now();
    this.simClockBaseMs = this.simEpochBaseMs;
    this.lastRealTimestampMs = this.simEpochBaseMs;

    const simNow = this.getSimNowMs();
    const planets = getPlanetsForStar(homeStar);
    const homePlanet = planets[Math.min(1, planets.length - 1)] ?? planets[0];

    const homeKey = this.keyFor(homePlanet.id);
    this.deltas.set(homeKey, {
      planetIdHex: homeKey,
      customName: `${homeStar.name} Prime`,
      owner: "Player",
      homeworldBoost: true,
      mines: 10,
      factories: 10,
      hasStarbase: true,
      buildQueue: [],
      populationAtCheckpoint: 65_000,
      surfaceIroniumKtAtCheckpoint: 220,
      surfaceBoraniumKtAtCheckpoint: 170,
      surfaceGermaniumKtAtCheckpoint: 195,
      colonizedAtSimMs: simNow,
      lastCheckpointSimMs: simNow,
    });

    this.scannedStars.add(formatId(homeStar.id));

    const homePos = getPlanetPositionMeters(homeStar, homePlanet, simNow);

    // Classic Stars! starting fleets: independent Scout, Colony Ship, and Destroyer
    const fScoutId = `F-${this.nextFleetSeq++}`;
    this.fleets.set(fScoutId, {
      id: fScoutId,
      name: "Long Range Scout #1",
      owner: "Player",
      ships: { scout: 1, colony: 0, freighter: 0, destroyer: 0 },
      cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 },
      fuelPct: 100,
      burnLevel: 5,
      burnMode: "orbit",
      orbitTargetId: homePlanet.id,
      originX: homePos.xMeters,
      originY: homePos.yMeters,
      destX: homePos.xMeters,
      destY: homePos.yMeters,
      destTargetId: null,
      departureSimMs: simNow,
      arrivalSimMs: simNow,
    });

    const fColonyId = `F-${this.nextFleetSeq++}`;
    this.fleets.set(fColonyId, {
      id: fColonyId,
      name: "Santa Maria #2",
      owner: "Player",
      ships: { scout: 0, colony: 1, freighter: 0, destroyer: 0 },
      cargo: { ironium: 20, boranium: 15, germanium: 20, colonists: 25_000 },
      fuelPct: 100,
      burnLevel: 5,
      burnMode: "orbit",
      orbitTargetId: homePlanet.id,
      originX: homePos.xMeters,
      originY: homePos.yMeters,
      destX: homePos.xMeters,
      destY: homePos.yMeters,
      destTargetId: null,
      departureSimMs: simNow,
      arrivalSimMs: simNow,
    });

    const fDestroyerId = `F-${this.nextFleetSeq++}`;
    this.fleets.set(fDestroyerId, {
      id: fDestroyerId,
      name: "Stalwart #3",
      owner: "Player",
      ships: { scout: 0, colony: 0, freighter: 0, destroyer: 1 },
      cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 },
      fuelPct: 100,
      burnLevel: 5,
      burnMode: "orbit",
      orbitTargetId: homePlanet.id,
      originX: homePos.xMeters,
      originY: homePos.yMeters,
      destX: homePos.xMeters,
      destY: homePos.yMeters,
      destTargetId: null,
      departureSimMs: simNow,
      arrivalSimMs: simNow,
    });

    // Find a neighboring star ~6 to 16 light-years away for the Xenon Rival Empire
    let rivalStar: StarData | null = null;
    for (let r = 6; r <= 18 && !rivalStar; r++) {
      for (let dx = -r; dx <= r && !rivalStar; dx++) {
        for (let dy = -r; dy <= r && !rivalStar; dy++) {
          if (Math.hypot(dx, dy) < 6) continue;
          const candidates = getCellStars(homeStar.cellX + dx, homeStar.cellY + dy);
          if (candidates.length > 0) {
            rivalStar = candidates[0];
          }
        }
      }
    }

    if (rivalStar) {
      const rivalPlanets = getPlanetsForStar(rivalStar);
      const rivalHome = rivalPlanets[0];
      const rivalKey = this.keyFor(rivalHome.id);
      this.deltas.set(rivalKey, {
        planetIdHex: rivalKey,
        customName: `${rivalStar.name} Core (Xenon)`,
        owner: "Xenon",
        homeworldBoost: true,
        mines: 10,
        factories: 10,
        hasStarbase: true,
        buildQueue: [{ type: "destroyer", count: 1, progressResources: 0 }],
        populationAtCheckpoint: 35_000,
        surfaceIroniumKtAtCheckpoint: 160,
        surfaceBoraniumKtAtCheckpoint: 130,
        surfaceGermaniumKtAtCheckpoint: 150,
        colonizedAtSimMs: simNow,
        lastCheckpointSimMs: simNow,
      });

      const rPos = getPlanetPositionMeters(rivalStar, rivalHome, simNow);
      const rivalFleetId = `X-${this.nextFleetSeq++}`;
      this.fleets.set(rivalFleetId, {
        id: rivalFleetId,
        name: "Xenon Guard #1",
        owner: "Xenon",
        ships: { scout: 0, colony: 0, freighter: 0, destroyer: 1 },
        cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 },
        fuelPct: 100,
        burnLevel: 5,
        burnMode: "orbit",
        orbitTargetId: rivalHome.id,
        originX: rPos.xMeters,
        originY: rPos.yMeters,
        destX: rPos.xMeters,
        destY: rPos.yMeters,
        destTargetId: null,
        departureSimMs: simNow,
        arrivalSimMs: simNow,
      });
    }

    this.addLog(
      `Colony established on ${homeStar.name} Prime. Develop your home system or launch probes to nearby stars!`,
      "colony",
      simNow,
    );
    this.saveToStorage();
  }

  getDelta(planetId: bigint): PlanetDelta | undefined {
    return this.deltas.get(this.keyFor(planetId));
  }

  hasDelta(planetId: bigint): boolean {
    return this.deltas.has(this.keyFor(planetId));
  }

  getAllDeltas(): { id: bigint; delta: PlanetDelta }[] {
    const out: { id: bigint; delta: PlanetDelta }[] = [];
    for (const delta of this.deltas.values()) {
      const id = parseId(delta.planetIdHex);
      if (id !== null) out.push({ id, delta });
    }
    return out;
  }

  getAllFleets(): Fleet[] {
    return Array.from(this.fleets.values());
  }

  getFleetById(id: string): Fleet | undefined {
    return this.fleets.get(id);
  }

  /**
   * Computes a fleet's exact 1-meter coordinates at `simNowMs`.
   * - In Orbit: locks to parent star/planet Keplerian orbit.
   * - In Transit ("orbit" mode): interpolates between origin and destination `[0..1]`.
   * - In Transit ("flyby" ballistic mode): extrapolates linearly PAST `arrivalSimMs` (`progress > 1`)
   *   so a probe that used 100% fuel on acceleration coasts through the target system and out into deep space forever!
   */
  getFleetPositionMeters(
    fleet: Fleet,
    simNowMs: number,
  ): { xMeters: bigint; yMeters: bigint; inOrbit: boolean; progress: number; isCoastingPast: boolean } {
    if (fleet.orbitTargetId !== null) {
      const { planetIndex } = unpackId(fleet.orbitTargetId);
      const star = getStarById(fleet.orbitTargetId);
      if (star) {
        if (planetIndex >= 1) {
          const planets = getPlanetsForStar(star);
          const p = planets[planetIndex - 1];
          if (p) {
            const pos = getPlanetPositionMeters(star, p, simNowMs);
            return { xMeters: pos.xMeters, yMeters: pos.yMeters, inOrbit: true, progress: 1, isCoastingPast: false };
          }
        }
        return { xMeters: star.xMeters, yMeters: star.yMeters, inOrbit: true, progress: 1, isCoastingPast: false };
      }
    }

    const totalDur = Math.max(1, fleet.arrivalSimMs - fleet.departureSimMs);
    const rawElapsed = Math.max(0, simNowMs - fleet.departureSimMs);
    const elapsed = fleet.burnMode === "flyby" ? rawElapsed : Math.min(totalDur, rawElapsed);
    const progress = elapsed / totalDur;
    const scaleBp = BigInt(Math.round(progress * 1_000_000));

    const dx = ((fleet.destX - fleet.originX) * scaleBp) / 1_000_000n;
    const dy = ((fleet.destY - fleet.originY) * scaleBp) / 1_000_000n;

    return {
      xMeters: fleet.originX + dx,
      yMeters: fleet.originY + dy,
      inOrbit: false,
      progress,
      isCoastingPast: fleet.burnMode === "flyby" && rawElapsed > totalDur,
    };
  }

  getBurnSpeedFactor(burnLevel: number): number {
    const lvl = Math.max(1, Math.min(10, burnLevel || 5));
    return 0.30 + 0.70 * Math.pow((lvl - 1) / 4, 1.35);
  }

  getBurnFuelFactor(burnLevel: number): number {
    const lvl = Math.max(1, Math.min(10, burnLevel || 5));
    return 0.22 + 0.78 * Math.pow((lvl - 1) / 4, 1.65);
  }

  /**
   * Interstellar delta-v cruise speed in light-years per sim minute.
   * Scales with `fleet.burnLevel` (1..10, like Stars! Warp 1..10), hull mass, cargo mass, and Orbit/Flyby mode.
   */
  getFleetCruiseSpeedLyPerMin(
    fleet: Fleet,
    burnMode: BurnMode = fleet.burnMode,
    burnLevel: number = fleet.burnLevel ?? 5,
  ): number {
    let baseSpeed = 0.17; // Scout probe at Burn 5 (~2.55 ly per 15-min Game Year in Orbit mode)
    if (fleet.ships.colony > 0) baseSpeed = 0.11;
    else if (fleet.ships.freighter > 0) baseSpeed = 0.14;
    else if (fleet.ships.destroyer > 0) baseSpeed = 0.16;

    const cargoMassKt =
      fleet.cargo.ironium +
      fleet.cargo.boranium +
      fleet.cargo.germanium +
      Math.round(fleet.cargo.colonists / 500);
    const massFactor = 1 / (1 + cargoMassKt / 600);

    const burnSpeedFactor = this.getBurnSpeedFactor(burnLevel);
    const modeMultiplier = burnMode === "flyby" ? 1.65 : 1.0;
    return Number((baseSpeed * massFactor * burnSpeedFactor * modeMultiplier).toFixed(2));
  }

  /**
   * Space-traffic radar radius in light-years (detects ships in space; does NOT scan planet surfaces from afar).
   */
  getFleetScannerLy(ships: ShipCounts): number {
    if (ships.scout > 0) return 0.75;
    if (ships.destroyer > 0) return 0.55;
    return 0.4;
  }

  /**
   * Computes a fleet's onboard Power Reserve (`0..100%`) at `simNowMs`.
   *
   * Design balance:
   * - While in orbit around any star/planet, solar collectors & reactor maintenance keep power at 100%.
   * - While flying within ~3.5 ly of any friendly colony in standard orbit-transfer mode, power generation
   *   covers nearly all draw so domestic fleets never run out of power.
   * - When launched into deep interstellar space (> 3.5 ly from nearest colony, or on a ballistic flyby),
   *   long-range telemetry transmission draw scales with distance squared (inverse-square law) plus RTG drain,
   *   depleting deep-space probes by ~7-8 ly so a single probe cannot chart the whole sector.
   */
  getFleetPowerState(
    fleet: Fleet,
    simNowMs: number,
  ): { powerPct: number; isPowered: boolean; distFromEmpireLy: number; statusNote: string } {
    if (fleet.isDerelict) {
      return {
        powerPct: 0,
        isPowered: false,
        distFromEmpireLy: 0,
        statusNote: "0% (Derelict — Power Exhausted)",
      };
    }

    if (fleet.orbitTargetId !== null) {
      return {
        powerPct: 100,
        isPowered: true,
        distFromEmpireLy: 0,
        statusNote: "100% (Solar / Orbital Equilibrium)",
      };
    }

    const pos = this.getFleetPositionMeters(fleet, simNowMs);
    const traveledMeters = Math.hypot(
      Number(pos.xMeters - fleet.originX),
      Number(pos.yMeters - fleet.originY),
    );
    const distTraveledLy = traveledMeters / Number(METERS_PER_LIGHT_YEAR);

    // Distance to nearest friendly colony
    let minColonyDistMeters = Infinity;
    for (const { id, delta } of this.getAllDeltas()) {
      if (delta.owner !== fleet.owner) continue;
      const colStar = getStarById(id);
      if (!colStar) continue;
      const d = Math.hypot(
        Number(colStar.xMeters - pos.xMeters),
        Number(colStar.yMeters - pos.yMeters),
      );
      if (d < minColonyDistMeters) minColonyDistMeters = d;
    }

    const distFromEmpireLy =
      minColonyDistMeters === Infinity
        ? distTraveledLy
        : minColonyDistMeters / Number(METERS_PER_LIGHT_YEAR);

    // Inside empire frontier (<= 3.5 ly from nearest colony) in standard orbit mode:
    if (distFromEmpireLy <= 3.5 && fleet.burnMode === "orbit") {
      const mildDrain = Math.min(18, Math.round(distTraveledLy * 3.5));
      const powerPct = Math.max(82, 100 - mildDrain);
      return {
        powerPct,
        isPowered: true,
        distFromEmpireLy: Number(distFromEmpireLy.toFixed(1)),
        statusNote: `${powerPct}% (Empire Grid / Nominal)`,
      };
    }

    // Deep-space or Ballistic Flyby: inverse-square transmitter load + deep-space sensor drain,
    // partially offset by perihelion solar array harvesting during gravity-assist slingshots!
    const slingshotSolarBoost = (fleet.slingshotsCompleted ?? 0) * 10;
    const deepExcessLy = Math.max(0, distFromEmpireLy - 2.8);
    const inverseSquareTxDrain = deepExcessLy * deepExcessLy * 3.8;
    const baseDeepDrain = distTraveledLy * 8.0;
    const powerPct = Math.max(
      0,
      Math.min(100, Math.round(100 + slingshotSolarBoost - (baseDeepDrain + inverseSquareTxDrain))),
    );

    return {
      powerPct,
      isPowered: powerPct > 0,
      distFromEmpireLy: Number(distFromEmpireLy.toFixed(1)),
      statusNote:
        powerPct > 0
          ? `${powerPct}% (Deep-Space @ ${distFromEmpireLy.toFixed(1)} ly)`
          : "0% (Derelict — Power Exhausted)",
    };
  }

  /**
   * Computes the deflection angle in degrees [0..180] between incoming vector (p0 -> p1)
   * and outgoing vector (p1 -> p2).
   */
  private computeDeflectionDegrees(
    x0: bigint,
    y0: bigint,
    x1: bigint,
    y1: bigint,
    x2: bigint,
    y2: bigint,
  ): number {
    const v1x = Number(x1 - x0);
    const v1y = Number(y1 - y0);
    const v2x = Number(x2 - x1);
    const v2y = Number(y2 - y1);
    const mag1 = Math.hypot(v1x, v1y);
    const mag2 = Math.hypot(v2x, v2y);
    if (mag1 < 1 || mag2 < 1) return 0;

    const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (mag1 * mag2)));
    return Math.round((Math.acos(dot) * 180) / Math.PI);
  }

  /**
   * Evaluates a single-target or multi-waypoint Gravity-Assist Route Plan for `fleet`,
   * returning exact per-leg fuel costs, deflection angles, and total fuel required.
   */
  evaluateRoutePlan(
    fleet: Fleet,
    candidateTargets: bigint[],
    simNowMs: number,
  ): RoutePlanSummary {
    const legs: RouteLegSummary[] = [];
    if (candidateTargets.length === 0) {
      return {
        legs: [],
        totalFuelRequiredPct: 0,
        remainingFuelAfterPct: Math.round(fleet.fuelPct),
        totalEtaSimSeconds: 0,
        totalEtaGameYears: 0,
        canAffordFuel: true,
      };
    }

    const startPos = this.getFleetPositionMeters(fleet, simNowMs);
    let prevX = startPos.xMeters;
    let prevY = startPos.yMeters;
    let priorAnchorX = fleet.orbitTargetId === null ? fleet.originX : startPos.xMeters;
    let priorAnchorY = fleet.orbitTargetId === null ? fleet.originY : startPos.yMeters;
    let prevStarMassSolar = 1.0;

    const burnFuelFactor = this.getBurnFuelFactor(fleet.burnLevel ?? 5);
    const speedLyPerMin = this.getFleetCruiseSpeedLyPerMin(fleet, fleet.burnMode, fleet.burnLevel ?? 5);

    let totalFuel = 0;
    let totalEtaSimSeconds = 0;

    for (let i = 0; i < candidateTargets.length; i++) {
      const tId = candidateTargets[i];
      const star = getStarById(tId);
      if (!star) continue;
      const { planetIndex } = unpackId(tId);
      const planets = getPlanetsForStar(star);
      const planet = planetIndex >= 1 ? planets[planetIndex - 1] ?? null : null;

      const toX = star.xMeters;
      const toY = star.yMeters;
      const distMeters = Math.hypot(Number(toX - prevX), Number(toY - prevY));
      const distLy = Number((distMeters / Number(METERS_PER_LIGHT_YEAR)).toFixed(2));
      const isIntraSystem = distMeters < Number(METERS_PER_LIGHT_YEAR) * 0.02;
      const isFinalLeg = i === candidateTargets.length - 1;

      if (isIntraSystem) {
        const distAu = distMeters / 149_597_870_700;
        totalEtaSimSeconds += Math.max(25, Math.min(90, Math.round(distAu * 15)));
      } else {
        totalEtaSimSeconds += Math.max(8, Math.round((distLy / speedLyPerMin) * 60));
      }

      let deflectionDeg = 0;
      let accelOrTcmFuelPct = 0;
      let brakeFuelPct = 0;
      let maneuverLabel = "";

      if (isIntraSystem) {
        accelOrTcmFuelPct = 4;
        brakeFuelPct = isFinalLeg && fleet.burnMode === "orbit" ? 4 : 0;
        maneuverLabel = "Intra-System Hop";
      } else if (i === 0 && fleet.orbitTargetId !== null) {
        // Initial interstellar departure burn from orbit, scaled by Burn Level (1..10)!
        // At Burn 10 in Flyby mode, caps at 100% so the player can blow their entire tank on a max-speed sprint!
        const rawAccel = Math.max(6, Math.round(35 * burnFuelFactor));
        accelOrTcmFuelPct =
          isFinalLeg && fleet.burnMode === "flyby" ? Math.min(100, rawAccel) : rawAccel;
        brakeFuelPct =
          isFinalLeg && fleet.burnMode === "orbit"
            ? Math.max(4, Math.round(25 * burnFuelFactor))
            : 0;
        maneuverLabel =
          brakeFuelPct > 0
            ? `Accel (${accelOrTcmFuelPct}%) + Brake (${brakeFuelPct}%)`
            : `Departure Burn (${accelOrTcmFuelPct}%)`;
      } else {
        // Gravity-Assist Slingshot around the previous waypoint star (slower burnLevels bend much more cheaply!)
        deflectionDeg = this.computeDeflectionDegrees(
          priorAnchorX,
          priorAnchorY,
          prevX,
          prevY,
          toX,
          toY,
        );
        const massAssistFactor = 1 / Math.max(0.65, Math.pow(prevStarMassSolar, 0.22));
        const baseTcm = (6 + 30 * Math.pow(deflectionDeg / 180, 1.35)) * massAssistFactor;
        accelOrTcmFuelPct = Math.max(2, Math.round(baseTcm * Math.pow(burnFuelFactor, 0.75)));
        brakeFuelPct =
          isFinalLeg && fleet.burnMode === "orbit"
            ? Math.max(4, Math.round(25 * burnFuelFactor))
            : 0;
        maneuverLabel = `Slingshot (${deflectionDeg}°, ${accelOrTcmFuelPct}% TCM${brakeFuelPct > 0 ? ` + ${brakeFuelPct}% Brake` : ""})`;
      }

      const legTotalFuelPct = accelOrTcmFuelPct + brakeFuelPct;
      totalFuel += legTotalFuelPct;

      legs.push({
        legIndex: i + 1,
        fromX: prevX,
        fromY: prevY,
        toX,
        toY,
        targetId: tId,
        targetName: planet ? planet.name : star.name,
        distLy,
        deflectionDeg,
        accelOrTcmFuelPct,
        brakeFuelPct,
        legTotalFuelPct,
        maneuverLabel,
      });

      priorAnchorX = prevX;
      priorAnchorY = prevY;
      prevX = toX;
      prevY = toY;
      prevStarMassSolar = star.massSolar;
    }

    const remaining = Math.round(fleet.fuelPct - totalFuel);
    const totalEtaGameYears = Number(
      (totalEtaSimSeconds / (60 * SIM_MINUTES_PER_GAME_YEAR)).toFixed(1),
    );
    return {
      legs,
      totalFuelRequiredPct: totalFuel,
      remainingFuelAfterPct: remaining,
      totalEtaSimSeconds,
      totalEtaGameYears,
      canAffordFuel: remaining >= 0,
    };
  }

  addWaypointToFleetRoute(fleetId: string, targetId: bigint): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet || fleet.owner !== "Player") return;
    if (!fleet.plannedRoute) fleet.plannedRoute = [];
    // Avoid duplicate consecutive waypoints
    if (
      fleet.plannedRoute.length > 0 &&
      fleet.plannedRoute[fleet.plannedRoute.length - 1] === targetId
    ) {
      return;
    }
    fleet.plannedRoute.push(targetId);
    this.saveToStorage();
  }

  popFleetRouteWaypoint(fleetId: string): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet || !fleet.plannedRoute || fleet.plannedRoute.length === 0) return;
    fleet.plannedRoute.pop();
    this.saveToStorage();
  }

  clearFleetRoute(fleetId: string): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) return;
    fleet.plannedRoute = [];
    this.saveToStorage();
  }

  setFleetBurnMode(fleetId: string, mode: BurnMode): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet || fleet.owner !== "Player") return;
    fleet.burnMode = mode;
    this.saveToStorage();
  }

  setFleetBurnLevel(fleetId: string, level: number): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet || fleet.owner !== "Player") return;
    fleet.burnLevel = Math.max(1, Math.min(10, Math.round(level)));
    this.saveToStorage();
  }

  refuelFleet(fleetId: string): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet || fleet.orbitTargetId === null) return;
    fleet.fuelPct = 100;
    this.saveToStorage();
  }

  /**
   * Merges all other friendly fleets orbiting the exact same star/planet into `fleetId`.
   */
  mergeOrbitingFleets(fleetId: string): void {
    const primary = this.fleets.get(fleetId);
    if (!primary || primary.owner !== "Player" || primary.orbitTargetId === null) return;

    let mergedCount = 0;
    for (const other of Array.from(this.fleets.values())) {
      if (
        other.id !== primary.id &&
        other.owner === "Player" &&
        other.orbitTargetId === primary.orbitTargetId
      ) {
        primary.ships.scout += other.ships.scout;
        primary.ships.colony += other.ships.colony;
        primary.ships.freighter += other.ships.freighter;
        primary.ships.destroyer += other.ships.destroyer;

        primary.cargo.ironium += other.cargo.ironium;
        primary.cargo.boranium += other.cargo.boranium;
        primary.cargo.germanium += other.cargo.germanium;
        primary.cargo.colonists += other.cargo.colonists;

        primary.fuelPct = Math.min(primary.fuelPct, other.fuelPct);
        this.fleets.delete(other.id);
        mergedCount++;
      }
    }

    if (mergedCount > 0) {
      this.addLog(`Merged ${mergedCount} orbiting fleet(s) into ${primary.name}.`, "info");
      this.saveToStorage();
    }
  }

  /**
   * Splits a multi-ship fleet in orbit into individual single-ship fleets.
   */
  splitFleet(fleetId: string, simNowMs: number): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet || fleet.owner !== "Player" || fleet.orbitTargetId === null) return;

    const totalShips =
      fleet.ships.scout + fleet.ships.colony + fleet.ships.freighter + fleet.ships.destroyer;
    if (totalShips <= 1) return;

    const types: ("scout" | "colony" | "freighter" | "destroyer")[] = [
      "scout",
      "colony",
      "freighter",
      "destroyer",
    ];
    let keptFirst = false;
    const origShips = { ...fleet.ships };

    for (const t of types) {
      for (let i = 0; i < origShips[t]; i++) {
        if (!keptFirst) {
          fleet.ships = { scout: 0, colony: 0, freighter: 0, destroyer: 0 };
          fleet.ships[t] = 1;
          keptFirst = true;
        } else {
          const newId = `F-${this.nextFleetSeq++}`;
          const newShips: ShipCounts = { scout: 0, colony: 0, freighter: 0, destroyer: 0 };
          newShips[t] = 1;
          this.fleets.set(newId, {
            id: newId,
            name: `${BUILD_CATALOG[t].label} #${this.nextFleetSeq - 1}`,
            owner: "Player",
            ships: newShips,
            cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 },
            fuelPct: fleet.fuelPct,
            burnLevel: fleet.burnLevel,
            burnMode: fleet.burnMode,
            orbitTargetId: fleet.orbitTargetId,
            originX: fleet.originX,
            originY: fleet.originY,
            destX: fleet.destX,
            destY: fleet.destY,
            destTargetId: null,
            departureSimMs: simNowMs,
            arrivalSimMs: simNowMs,
          });
        }
      }
    }

    this.addLog(`Split ${fleet.name} into ${totalShips} independent fleets.`, "info", simNowMs);
    this.saveToStorage();
  }

  /**
   * Launches a fleet along its `plannedRoute` (if non-empty) or to a single `targetId`.
   */
  orderFleetToTarget(fleetId: string, targetId: bigint, simNowMs: number): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet || fleet.owner !== "Player") return;

    const pwr = this.getFleetPowerState(fleet, simNowMs);
    if (!pwr.isPowered) {
      this.addLog(
        `${fleet.name} is derelict (0% power in deep space) and cannot receive orders or ignite thrusters.`,
        "info",
        simNowMs,
      );
      return;
    }

    const targetsToLaunch =
      fleet.plannedRoute && fleet.plannedRoute.length > 0
        ? [...fleet.plannedRoute]
        : [targetId];

    const plan = this.evaluateRoutePlan(fleet, targetsToLaunch, simNowMs);
    if (plan.legs.length === 0) return;

    if (!plan.canAffordFuel) {
      this.addLog(
        `${fleet.name} lacks fuel for this route (${plan.totalFuelRequiredPct}% required, ${Math.round(fleet.fuelPct)}% available). Remove a waypoint or switch to Flyby mode!`,
        "info",
        simNowMs,
      );
      return;
    }

    // Deduct Leg 1 acceleration/TCM fuel (plus brake fuel if this is a 1-leg orbit transfer)
    const firstLeg = plan.legs[0];
    const firstLegFuel =
      plan.legs.length === 1 ? firstLeg.legTotalFuelPct : firstLeg.accelOrTcmFuelPct;
    fleet.fuelPct = Math.max(0, fleet.fuelPct - firstLegFuel);

    fleet.plannedRoute = [];
    fleet.queuedWaypoints = targetsToLaunch.slice(1);
    fleet.slingshotsCompleted = 0;

    this.beginFleetLeg(fleet, firstLeg.targetId, simNowMs);

    const routeNames = plan.legs.map((l) => l.targetName).join(" -> ");
    this.addLog(
      `${fleet.name} launched route: ${routeNames} (Total Plan: ${plan.totalFuelRequiredPct}% fuel).`,
      "info",
      simNowMs,
    );
    this.saveToStorage();
  }

  private beginFleetLeg(fleet: Fleet, nextTargetId: bigint, simNowMs: number): void {
    const star = getStarById(nextTargetId);
    if (!star) return;

    const currentPos = this.getFleetPositionMeters(fleet, simNowMs);
    const { planetIndex } = unpackId(nextTargetId);
    const planets = getPlanetsForStar(star);
    const targetPlanet = planetIndex >= 1 ? planets[planetIndex - 1] ?? null : null;

    const approxDx = Number(star.xMeters - currentPos.xMeters);
    const approxDy = Number(star.yMeters - currentPos.yMeters);
    const distMeters = Math.hypot(approxDx, approxDy);
    const isIntraSystem = distMeters < Number(METERS_PER_LIGHT_YEAR) * 0.02;

    let travelDurationMs: number;
    if (isIntraSystem) {
      const distAu = distMeters / 149_597_870_700;
      travelDurationMs = Math.max(25_000, Math.min(90_000, Math.round(distAu * 15_000)));
    } else {
      const speedLyPerMin = this.getFleetCruiseSpeedLyPerMin(fleet, fleet.burnMode);
      const speedMetersPerMs = (speedLyPerMin * Number(METERS_PER_LIGHT_YEAR)) / 60_000;
      travelDurationMs = Math.max(8_000, Math.round(distMeters / speedMetersPerMs));
    }

    const arrivalSimMs = simNowMs + travelDurationMs;

    let destX = star.xMeters;
    let destY = star.yMeters;
    if (targetPlanet) {
      const interceptPos = getPlanetPositionMeters(star, targetPlanet, arrivalSimMs);
      destX = interceptPos.xMeters;
      destY = interceptPos.yMeters;
    }

    fleet.orbitTargetId = null;
    fleet.originX = currentPos.xMeters;
    fleet.originY = currentPos.yMeters;
    fleet.destX = destX;
    fleet.destY = destY;
    fleet.destTargetId = nextTargetId;
    fleet.departureSimMs = simNowMs;
    fleet.arrivalSimMs = arrivalSimMs;
  }

  updateSimulation(simNowMs: number): boolean {
    let stateChanged = false;

    // 1. Advance planetary production queues
    for (const [key, delta] of this.deltas.entries()) {
      if (delta.buildQueue.length === 0) continue;
      const planetId = parseId(key);
      if (planetId === null) continue;
      const star = getStarById(planetId);
      if (!star) continue;
      const { planetIndex } = unpackId(planetId);
      const planet = getPlanetsForStar(star)[planetIndex - 1];
      if (!planet) continue;

      if (this.advancePlanetProduction(star, planet, delta, simNowMs)) {
        stateChanged = true;
      }
    }

    // 2. Resolve arriving finite-speed telemetry signals at colonies!
    for (const [starKey, sig] of this.pendingSignals.entries()) {
      if (simNowMs >= sig.arrivalSimMs) {
        this.pendingSignals.delete(starKey);
        this.scannedStars.add(starKey);
        this.addLog(
          `Telemetry signal received from ${sig.starName}! System data unlocked.`,
          "info",
          simNowMs,
        );
        stateChanged = true;
      }
    }

    // 3. Update fleets: auto-refuel at colonies, check deep-space power, sweep scanners, and handle arrivals
    for (const fleet of this.fleets.values()) {
      const pos = this.getFleetPositionMeters(fleet, simNowMs);
      const pwr = this.getFleetPowerState(fleet, simNowMs);

      if (!fleet.isDerelict && !pwr.isPowered) {
        fleet.isDerelict = true;
        this.addLog(
          `Signal lost with ${fleet.name} (${pwr.distFromEmpireLy} ly from nearest colony) — onboard power reserves exhausted.`,
          "info",
          simNowMs,
        );
        stateChanged = true;
      }

      // Auto-refuel if in orbit around a friendly colony
      if (fleet.orbitTargetId !== null && fleet.fuelPct < 100) {
        const delta = this.getDelta(fleet.orbitTargetId);
        if (delta && delta.owner === fleet.owner) {
          fleet.fuelPct = 100;
          fleet.isDerelict = false;
          stateChanged = true;
        }
      }

      // Planetary surface surveys require physically entering the star system (<= 0.12 ly from the star)!
      // Passive deep-space radar rings only detect moving ships, never planetary minerals/habitability from afar.
      if (fleet.owner === "Player" && pwr.isPowered) {
        const cx = Number(pos.xMeters / CELL_SIZE_METERS);
        const cy = Number(pos.yMeters / CELL_SIZE_METERS);
        const maxSurveyDistMeters = 0.06 * Number(METERS_PER_LIGHT_YEAR);

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const stars = getCellStars(cx + dx, cy + dy);
            for (const s of stars) {
              if (!this.isStarScanned(s.id) && !this.pendingSignals.has(formatId(s.id))) {
                const d = Math.hypot(
                  Number(s.xMeters - pos.xMeters),
                  Number(s.yMeters - pos.yMeters),
                );
                if (d <= maxSurveyDistMeters) {
                  if (this.emitTelemetryFromStar(s, simNowMs)) {
                    stateChanged = true;
                  }
                }
              }
            }
          }
        }
      }

      // Arrival at destination target (or intermediate Gravity-Assist Slingshot waypoint!)
      if (fleet.orbitTargetId === null && fleet.destTargetId !== null && simNowMs >= fleet.arrivalSimMs) {
        const star = getStarById(fleet.destTargetId);
        if (star && fleet.owner === "Player" && pwr.isPowered) {
          this.emitTelemetryFromStar(star, simNowMs);
        }

        // Check if there are more queued waypoints in a Gravity-Assist Grand Tour!
        if (fleet.queuedWaypoints && fleet.queuedWaypoints.length > 0 && pwr.isPowered) {
          const nextId = fleet.queuedWaypoints.shift()!;
          const nextStar = getStarById(nextId);
          const isFinalLegNow = fleet.queuedWaypoints.length === 0;

          if (star && nextStar) {
            const deflectionDeg = this.computeDeflectionDegrees(
              fleet.originX,
              fleet.originY,
              star.xMeters,
              star.yMeters,
              nextStar.xMeters,
              nextStar.yMeters,
            );
            const burnFuelFactor = this.getBurnFuelFactor(fleet.burnLevel ?? 5);
            const massAssistFactor = 1 / Math.max(0.65, Math.pow(star.massSolar, 0.22));
            const baseTcm = (6 + 30 * Math.pow(deflectionDeg / 180, 1.35)) * massAssistFactor;
            const tcmFuel = Math.max(2, Math.round(baseTcm * Math.pow(burnFuelFactor, 0.75)));
            const brakeFuel =
              isFinalLegNow && fleet.burnMode === "orbit"
                ? Math.max(4, Math.round(25 * burnFuelFactor))
                : 0;
            fleet.fuelPct = Math.max(0, fleet.fuelPct - (tcmFuel + brakeFuel));
          }

          fleet.slingshotsCompleted = (fleet.slingshotsCompleted ?? 0) + 1;
          const prevLabel = star ? star.name : "waypoint";
          const nextLabel = nextStar ? nextStar.name : formatId(nextId);
          this.beginFleetLeg(fleet, nextId, simNowMs);
          this.addLog(
            `${fleet.name} executed gravity-assist slingshot around ${prevLabel} -> heading to ${nextLabel}!`,
            "info",
            simNowMs,
          );
          stateChanged = true;
        } else if (fleet.burnMode === "flyby") {
          // Ballistic flyby: do NOT enter orbit! Clear destTargetId so we don't re-trigger,
          // but keep orbitTargetId === null so the probe continues coasting along its vector forever!
          const targetLabel = star ? star.name : formatId(fleet.destTargetId);
          fleet.destTargetId = null;
          this.addLog(
            `${fleet.name} completed high-speed flyby of ${targetLabel} and is coasting into deep space.`,
            "info",
            simNowMs,
          );
          stateChanged = true;
        } else {
          // Standard orbit transfer: decelerate into orbit
          fleet.orbitTargetId = fleet.destTargetId;
          fleet.destTargetId = null;
          fleet.slingshotsCompleted = 0;
          stateChanged = true;
          this.resolveOrbitalArrival(fleet, simNowMs);
        }
      }
    }

    if (stateChanged) {
      this.saveToStorage();
    }
    return stateChanged;
  }

  private resolveOrbitalArrival(arrivingFleet: Fleet, simNowMs: number): void {
    const targetId = arrivingFleet.orbitTargetId;
    if (targetId === null) return;

    const star = getStarById(targetId);
    const { planetIndex } = unpackId(targetId);
    const planet = star && planetIndex >= 1 ? getPlanetsForStar(star)[planetIndex - 1] : null;
    const locName = planet ? planet.name : star?.name ?? formatId(targetId);

    const targetStarKey = this.starKeyForObject(targetId);
    for (const other of this.fleets.values()) {
      if (other.id === arrivingFleet.id || other.owner === arrivingFleet.owner) continue;
      if (other.orbitTargetId === null) continue;
      if (this.starKeyForObject(other.orbitTargetId) !== targetStarKey) continue;

      const atkPower = arrivingFleet.ships.destroyer * 25 + arrivingFleet.ships.scout * 2;
      const defPower = other.ships.destroyer * 25 + other.ships.scout * 2;

      if (atkPower === 0 && defPower === 0) continue;

      if (atkPower >= defPower) {
        const losses = Math.min(
          arrivingFleet.ships.destroyer,
          Math.floor(defPower / 30),
        );
        arrivingFleet.ships.destroyer -= losses;
        this.fleets.delete(other.id);
        this.addLog(
          `Battle at ${locName}! ${arrivingFleet.name} destroyed ${other.name} (Lost ${losses} Destroyers).`,
          "combat",
          simNowMs,
        );
      } else {
        const losses = Math.min(other.ships.destroyer, Math.floor(atkPower / 30));
        other.ships.destroyer -= losses;
        this.fleets.delete(arrivingFleet.id);
        this.addLog(
          `Battle at ${locName}! ${arrivingFleet.name} was wiped out by ${other.name}!`,
          "combat",
          simNowMs,
        );
        return;
      }
    }

    if (planet && arrivingFleet.ships.destroyer > 0) {
      const delta = this.getDelta(planet.id);
      if (delta && delta.owner !== arrivingFleet.owner) {
        delta.owner = arrivingFleet.owner;
        delta.hasStarbase = false;
        delta.buildQueue = [];
        this.addLog(
          `${arrivingFleet.name} captured ${delta.customName || planet.name} for ${arrivingFleet.owner}!`,
          "combat",
          simNowMs,
        );
      }
    }
  }

  isQueueItemAtCap(item: BuildQueueItem, delta: PlanetDelta, current: EvaluatedPlanetState): boolean {
    if (item.type === "starbase") {
      return delta.hasStarbase;
    }
    if (!item.autoRepeat) return false;
    const operableCap = Math.min(current.workerCapStructures, current.maxPlanetStructures);
    const cap =
      item.autoCap === undefined || item.autoCap === "operable"
        ? operableCap
        : Math.min(item.autoCap, current.maxPlanetStructures);
    if (item.type === "mine") return delta.mines >= cap;
    if (item.type === "factory") return delta.factories >= cap;
    return false;
  }

  private advancePlanetProduction(
    star: StarData,
    base: PlanetData,
    delta: PlanetDelta,
    simNowMs: number,
  ): boolean {
    const elapsedMin = (simNowMs - delta.lastCheckpointSimMs) / 60_000;
    if (elapsedMin < 0.02) return false;

    const current = this.evaluate(base, simNowMs);
    const totalResProduced = current.resourcesPerMin * elapsedMin;

    const eligibleIdx = delta.buildQueue.findIndex(
      (item) => !this.isQueueItemAtCap(item, delta, current),
    );
    if (eligibleIdx === -1) return false;

    const topItem = delta.buildQueue[eligibleIdx];
    const spec = BUILD_CATALOG[topItem.type];
    const neededRes = spec.resources - topItem.progressResources;

    if (totalResProduced >= neededRes) {
      if (
        current.surfaceIroniumKt >= spec.ironium &&
        current.surfaceBoraniumKt >= spec.boranium &&
        current.surfaceGermaniumKt >= spec.germanium
      ) {
        delta.populationAtCheckpoint = current.population;
        delta.surfaceIroniumKtAtCheckpoint = Number((current.surfaceIroniumKt - spec.ironium).toFixed(2));
        delta.surfaceBoraniumKtAtCheckpoint = Number((current.surfaceBoraniumKt - spec.boranium).toFixed(2));
        delta.surfaceGermaniumKtAtCheckpoint = Number((current.surfaceGermaniumKt - spec.germanium).toFixed(2));
        delta.lastCheckpointSimMs = simNowMs;

        if (topItem.type === "mine") delta.mines += 1;
        else if (topItem.type === "factory") delta.factories += 1;
        else if (topItem.type === "starbase") delta.hasStarbase = true;
        else {
          this.spawnShipInOrbit(star, base, delta, topItem.type, simNowMs);
        }

        topItem.progressResources = 0;
        if (!topItem.autoRepeat) {
          topItem.count -= 1;
          topItem.batchBuilt = (topItem.batchBuilt ?? 0) + 1;
          if (topItem.count <= 0) {
            delta.buildQueue.splice(eligibleIdx, 1);
          }
        } else {
          topItem.batchBuilt = (topItem.batchBuilt ?? 0) + 1;
          if (
            topItem.batchBuilt >= topItem.count ||
            this.isQueueItemAtCap(topItem, delta, current)
          ) {
            topItem.batchBuilt = 0;
            delta.buildQueue.splice(eligibleIdx, 1);
            delta.buildQueue.push(topItem);
          }
        }

        this.addLog(
          `${delta.customName || base.name} completed ${spec.label}.`,
          "colony",
          simNowMs,
        );
        return true;
      }
    } else {
      delta.populationAtCheckpoint = current.population;
      delta.surfaceIroniumKtAtCheckpoint = current.surfaceIroniumKt;
      delta.surfaceBoraniumKtAtCheckpoint = current.surfaceBoraniumKt;
      delta.surfaceGermaniumKtAtCheckpoint = current.surfaceGermaniumKt;
      delta.lastCheckpointSimMs = simNowMs;
      topItem.progressResources = Number((topItem.progressResources + totalResProduced).toFixed(2));
    }
    return false;
  }

  private spawnShipInOrbit(
    star: StarData,
    planet: PlanetData,
    delta: PlanetDelta,
    shipType: "scout" | "colony" | "freighter" | "destroyer",
    simNowMs: number,
  ): void {
    const pos = getPlanetPositionMeters(star, planet, simNowMs);
    const fleetId = `${delta.owner === "Player" ? "F" : "X"}-${this.nextFleetSeq++}`;
    const ships: ShipCounts = { scout: 0, colony: 0, freighter: 0, destroyer: 0 };
    ships[shipType] = 1;

    const cargo: CargoManifest = { ironium: 0, boranium: 0, germanium: 0, colonists: 0 };
    if (shipType === "colony") {
      if (delta.populationAtCheckpoint > 35_000) {
        delta.populationAtCheckpoint -= 25_000;
      }
      cargo.colonists = 25_000;
    }

    this.fleets.set(fleetId, {
      id: fleetId,
      name: `${BUILD_CATALOG[shipType].label} #${this.nextFleetSeq - 1}`,
      owner: delta.owner,
      ships,
      cargo,
      fuelPct: 100,
      burnLevel: 5,
      burnMode: "orbit",
      orbitTargetId: planet.id,
      originX: pos.xMeters,
      originY: pos.yMeters,
      destX: pos.xMeters,
      destY: pos.yMeters,
      destTargetId: null,
      departureSimMs: simNowMs,
      arrivalSimMs: simNowMs,
    });
  }

  evaluate(base: PlanetData, simNowMs: number): EvaluatedPlanetState {
    const delta = this.getDelta(base.id);
    if (!delta) {
      const maxPop = Math.max(25_000, Math.max(1, base.habitabilityPct) * 10_000);
      const maxStruct = Math.max(10, Math.max(1, base.habitabilityPct) * 10);
      return {
        isModified: false,
        owner: null,
        displayName: base.name,
        effectiveHabitabilityPct: base.habitabilityPct,
        mines: 0,
        operableMines: 0,
        factories: 0,
        operableFactories: 0,
        workerCapStructures: 0,
        maxPlanetStructures: maxStruct,
        hasStarbase: false,
        buildQueue: [],
        population: 0,
        maxPopulation: maxPop,
        populationGrowthPerMin: 0,
        resourcesPerMin: 0,
        surfaceIroniumKt: base.surfaceIroniumKt,
        surfaceBoraniumKt: base.surfaceBoraniumKt,
        surfaceGermaniumKt: base.surfaceGermaniumKt,
        ironiumMiningRatePerMin: 0,
        boraniumMiningRatePerMin: 0,
        germaniumMiningRatePerMin: 0,
      };
    }

    const effectiveHab = delta.homeworldBoost ? 100 : delta.sisterWorldBoost ? 55 : base.habitabilityPct;
    const elapsedMinutes = Math.max(0, (simNowMs - delta.lastCheckpointSimMs) / 60_000);
    const yearScale = 1 / SIM_MINUTES_PER_GAME_YEAR; // 1 Stars! Year = 4.0 Sim Minutes

    // 1. Stars! Planet Carrying Capacity & Logistic Crowding Growth Curve
    // Max pop = Habitability% * 10,000 (1,000,000 on a 100% world).
    // Humanoid base annual growth = 15% per Game Year -> 15% * yearScale per Sim Minute.
    const maxPopulation = Math.max(25_000, Math.max(1, effectiveHab) * 10_000);
    const baseGrowthRate = (effectiveHab / 100) * 0.15 * yearScale;
    const startRatio = delta.populationAtCheckpoint / maxPopulation;
    const crowdingMultiplier =
      effectiveHab <= 0
        ? 1.0
        : startRatio <= 0.25
          ? 1.0
          : (16 / 9) * Math.pow(Math.max(0, 1 - startRatio), 2);
    const effectiveGrowthFactorPerMin = Math.max(-0.05, baseGrowthRate * crowdingMultiplier);

    const population = Math.max(
      100,
      Math.min(
        maxPopulation,
        Math.round(
          delta.populationAtCheckpoint * Math.exp(effectiveGrowthFactorPerMin * elapsedMinutes),
        ),
      ),
    );
    const currentRatio = population / maxPopulation;
    const currentCrowding =
      effectiveHab <= 0
        ? 1.0
        : currentRatio <= 0.25
          ? 1.0
          : (16 / 9) * Math.pow(Math.max(0, 1 - currentRatio), 2);
    const populationGrowthPerMin = Math.round(population * baseGrowthRate * currentCrowding);

    // 2. Stars! Worker Operation Caps: 1 Mine & 1 Factory operable per 1,000 colonists
    const workerCapStructures = Math.floor(population / 1_000);
    const maxPlanetStructures = Math.max(10, Math.max(1, effectiveHab) * 10);
    const operableMines = Math.min(delta.mines, workerCapStructures, maxPlanetStructures);
    const operableFactories = Math.min(delta.factories, workerCapStructures, maxPlanetStructures);

    // 3. Mining & Industrial Resource Output (1 Stars! Year = SIM_MINUTES_PER_GAME_YEAR sim minutes)
    const ironRate = Number((operableMines * (base.ironiumConc / 100) * yearScale).toFixed(2));
    const boraRate = Number((operableMines * (base.boraniumConc / 100) * yearScale).toFixed(2));
    const germRate = Number((operableMines * (base.germaniumConc / 100) * yearScale).toFixed(2));

    const surfaceIroniumKt = Number(
      (delta.surfaceIroniumKtAtCheckpoint + ironRate * elapsedMinutes).toFixed(1),
    );
    const surfaceBoraniumKt = Number(
      (delta.surfaceBoraniumKtAtCheckpoint + boraRate * elapsedMinutes).toFixed(1),
    );
    const surfaceGermaniumKt = Number(
      (delta.surfaceGermaniumKtAtCheckpoint + germRate * elapsedMinutes).toFixed(1),
    );

    // Humanoid standard: (1 Res per 1,000 pop + 1 Res per operable Factory) per Game Year
    const resourcesPerYear = Math.floor(population / 1_000) + operableFactories * 1.0;
    const resourcesPerMin = Number((resourcesPerYear * yearScale).toFixed(1));

    return {
      isModified: true,
      owner: delta.owner,
      displayName: delta.customName || base.name,
      effectiveHabitabilityPct: effectiveHab,
      mines: delta.mines,
      operableMines,
      factories: delta.factories,
      operableFactories,
      workerCapStructures,
      maxPlanetStructures,
      hasStarbase: delta.hasStarbase,
      buildQueue: delta.buildQueue,
      population,
      maxPopulation,
      populationGrowthPerMin,
      resourcesPerMin,
      surfaceIroniumKt,
      surfaceBoraniumKt,
      surfaceGermaniumKt,
      ironiumMiningRatePerMin: ironRate,
      boraniumMiningRatePerMin: boraRate,
      germaniumMiningRatePerMin: germRate,
    };
  }

  enqueueBuildItem(
    base: PlanetData,
    type: BuildableType,
    count: number,
    simNowMs: number,
    options?: { autoRepeat?: boolean; autoCap?: number | "operable" },
  ): void {
    const delta = this.getDelta(base.id);
    if (!delta || delta.owner !== "Player") return;

    const spec = BUILD_CATALOG[type];
    if (spec.category === "ship" && !delta.hasStarbase) return;
    if (type === "starbase" && delta.hasStarbase) return;

    const clampedCount = Math.max(1, Math.min(MAX_QUEUE_ITEM_COUNT, Math.round(count)));
    const isAuto = Boolean(options?.autoRepeat && type !== "starbase");

    const current = this.evaluate(base, simNowMs);
    delta.populationAtCheckpoint = current.population;
    delta.surfaceIroniumKtAtCheckpoint = current.surfaceIroniumKt;
    delta.surfaceBoraniumKtAtCheckpoint = current.surfaceBoraniumKt;
    delta.surfaceGermaniumKtAtCheckpoint = current.surfaceGermaniumKt;
    delta.lastCheckpointSimMs = simNowMs;

    if (isAuto) {
      const cap =
        type === "mine" || type === "factory"
          ? options?.autoCap ?? "operable"
          : undefined;
      delta.buildQueue.push({
        type,
        count: clampedCount,
        batchBuilt: 0,
        progressResources: 0,
        autoRepeat: true,
        autoCap: typeof cap === "number" ? Math.max(1, Math.min(MAX_QUEUE_ITEM_COUNT, Math.round(cap))) : cap,
      });
    } else {
      // Insert after the last non-auto item and before the first auto item
      const firstAutoIdx = delta.buildQueue.findIndex((i) => i.autoRepeat);
      const insertIdx = firstAutoIdx === -1 ? delta.buildQueue.length : firstAutoIdx;
      delta.buildQueue.splice(insertIdx, 0, {
        type,
        count: type === "starbase" ? 1 : clampedCount,
        progressResources: 0,
      });
    }
    this.saveToStorage();
  }

  clearBuildQueue(base: PlanetData): void {
    const delta = this.getDelta(base.id);
    if (!delta || delta.owner !== "Player") return;
    delta.buildQueue = [];
    this.saveToStorage();
  }

  moveQueueItem(base: PlanetData, index: number, deltaIndex: number): void {
    const delta = this.getDelta(base.id);
    if (!delta || delta.owner !== "Player") return;
    const target = index + deltaIndex;
    if (index < 0 || index >= delta.buildQueue.length) return;
    if (target < 0 || target >= delta.buildQueue.length) return;
    const [item] = delta.buildQueue.splice(index, 1);
    delta.buildQueue.splice(target, 0, item);
    this.saveToStorage();
  }

  adjustQueueItemCount(base: PlanetData, index: number, deltaCount: number): void {
    const delta = this.getDelta(base.id);
    if (!delta || delta.owner !== "Player") return;
    const item = delta.buildQueue[index];
    if (!item || item.type === "starbase") return;
    item.count = Math.max(1, Math.min(MAX_QUEUE_ITEM_COUNT, item.count + deltaCount));
    if (item.batchBuilt && item.batchBuilt >= item.count) {
      item.batchBuilt = item.count - 1;
    }
    this.saveToStorage();
  }

  toggleQueueAutoRepeat(base: PlanetData, index: number): void {
    const delta = this.getDelta(base.id);
    if (!delta || delta.owner !== "Player") return;
    const item = delta.buildQueue[index];
    if (!item || item.type === "starbase") return;
    item.autoRepeat = !item.autoRepeat;
    item.batchBuilt = 0;
    if (item.autoRepeat && (item.type === "mine" || item.type === "factory") && item.autoCap === undefined) {
      item.autoCap = "operable";
    }
    this.saveToStorage();
  }

  setQueueItemAutoCap(base: PlanetData, index: number, cap: number | "operable" | undefined): void {
    const delta = this.getDelta(base.id);
    if (!delta || delta.owner !== "Player") return;
    const item = delta.buildQueue[index];
    if (!item || (item.type !== "mine" && item.type !== "factory")) return;
    item.autoCap =
      typeof cap === "number"
        ? Math.max(1, Math.min(MAX_QUEUE_ITEM_COUNT, Math.round(cap)))
        : cap;
    this.saveToStorage();
  }

  removeQueueItem(base: PlanetData, index: number): void {
    const delta = this.getDelta(base.id);
    if (!delta || delta.owner !== "Player") return;
    delta.buildQueue.splice(index, 1);
    this.saveToStorage();
  }

  getFleetCargoCapacity(ships: ShipCounts): { maxColonists: number; maxMineralsKt: number } {
    return {
      maxColonists: ships.colony * 25_000 + ships.freighter * 50_000,
      maxMineralsKt: ships.colony * 100 + ships.freighter * 300,
    };
  }

  colonizeWithFleet(fleetId: string, base: PlanetData, simNowMs: number): boolean {
    const fleet = this.fleets.get(fleetId);
    if (!fleet || fleet.owner !== "Player" || fleet.ships.colony < 1) return false;
    if (fleet.cargo.colonists < 2_500) return false;
    if (this.hasDelta(base.id)) return false;

    const key = this.keyFor(base.id);
    const startingPop = fleet.cargo.colonists;

    this.deltas.set(key, {
      planetIdHex: key,
      owner: "Player",
      mines: 5,
      factories: 5,
      hasStarbase: false,
      buildQueue: [{ type: "mine", count: 5, progressResources: 0 }],
      populationAtCheckpoint: startingPop,
      surfaceIroniumKtAtCheckpoint: base.surfaceIroniumKt + fleet.cargo.ironium,
      surfaceBoraniumKtAtCheckpoint: base.surfaceBoraniumKt + fleet.cargo.boranium,
      surfaceGermaniumKtAtCheckpoint: base.surfaceGermaniumKt + fleet.cargo.germanium,
      colonizedAtSimMs: simNowMs,
      lastCheckpointSimMs: simNowMs,
    });

    fleet.ships.colony -= 1;
    fleet.cargo = { ironium: 0, boranium: 0, germanium: 0, colonists: 0 };

    const totalRemainingShips =
      fleet.ships.scout + fleet.ships.colony + fleet.ships.freighter + fleet.ships.destroyer;
    if (totalRemainingShips <= 0) {
      this.fleets.delete(fleet.id);
    }

    this.addLog(
      `New colony founded on ${base.name} with ${startingPop.toLocaleString()} colonists!`,
      "colony",
      simNowMs,
    );
    this.saveToStorage();
    return true;
  }

  transferCargo(
    fleetId: string,
    base: PlanetData,
    mode: "load_colonists" | "load_minerals" | "unload",
    simNowMs: number,
  ): void {
    const fleet = this.fleets.get(fleetId);
    const delta = this.getDelta(base.id);
    if (!fleet || !delta || delta.owner !== "Player" || fleet.orbitTargetId !== base.id) return;

    const current = this.evaluate(base, simNowMs);
    delta.populationAtCheckpoint = current.population;
    delta.surfaceIroniumKtAtCheckpoint = current.surfaceIroniumKt;
    delta.surfaceBoraniumKtAtCheckpoint = current.surfaceBoraniumKt;
    delta.surfaceGermaniumKtAtCheckpoint = current.surfaceGermaniumKt;
    delta.lastCheckpointSimMs = simNowMs;

    const { maxColonists, maxMineralsKt } = this.getFleetCargoCapacity(fleet.ships);

    if (mode === "load_colonists") {
      const room = Math.max(0, maxColonists - fleet.cargo.colonists);
      const availablePop = Math.max(0, delta.populationAtCheckpoint - 10_000);
      const amount = Math.min(25_000, room, availablePop);
      if (amount <= 0) return;

      delta.populationAtCheckpoint -= amount;
      fleet.cargo.colonists += amount;
      this.addLog(
        `Loaded ${amount.toLocaleString()} colonists from ${delta.customName || base.name} onto ${fleet.name}.`,
        "info",
        simNowMs,
      );
    } else if (mode === "load_minerals") {
      const currentLoad = fleet.cargo.ironium + fleet.cargo.boranium + fleet.cargo.germanium;
      const space = Math.max(0, maxMineralsKt - currentLoad);
      if (space <= 0) return;

      const takeEach = Math.floor(space / 3);
      const takeIron = Math.min(takeEach, Math.floor(delta.surfaceIroniumKtAtCheckpoint));
      const takeBora = Math.min(takeEach, Math.floor(delta.surfaceBoraniumKtAtCheckpoint));
      const takeGerm = Math.min(takeEach, Math.floor(delta.surfaceGermaniumKtAtCheckpoint));

      delta.surfaceIroniumKtAtCheckpoint -= takeIron;
      delta.surfaceBoraniumKtAtCheckpoint -= takeBora;
      delta.surfaceGermaniumKtAtCheckpoint -= takeGerm;

      fleet.cargo.ironium += takeIron;
      fleet.cargo.boranium += takeBora;
      fleet.cargo.germanium += takeGerm;
      this.addLog(
        `${fleet.name} loaded ${takeIron + takeBora + takeGerm} kT minerals from ${delta.customName || base.name}.`,
        "info",
        simNowMs,
      );
    } else {
      delta.surfaceIroniumKtAtCheckpoint += fleet.cargo.ironium;
      delta.surfaceBoraniumKtAtCheckpoint += fleet.cargo.boranium;
      delta.surfaceGermaniumKtAtCheckpoint += fleet.cargo.germanium;
      delta.populationAtCheckpoint += fleet.cargo.colonists;
      fleet.cargo = { ironium: 0, boranium: 0, germanium: 0, colonists: 0 };
      this.addLog(
        `${fleet.name} unloaded all colonists and minerals onto ${delta.customName || base.name}.`,
        "info",
        simNowMs,
      );
    }

    this.saveToStorage();
  }

  applyExactCargoTransfer(
    fleetId: string,
    base: PlanetData,
    desiredFleetCargo: CargoManifest,
    simNowMs: number,
  ): void {
    const fleet = this.fleets.get(fleetId);
    const delta = this.getDelta(base.id);
    if (!fleet || !delta || delta.owner !== "Player" || fleet.orbitTargetId !== base.id) return;

    const current = this.evaluate(base, simNowMs);
    const { maxColonists, maxMineralsKt } = this.getFleetCargoCapacity(fleet.ships);

    const totalColonists = current.population + fleet.cargo.colonists;
    const totalIron = current.surfaceIroniumKt + fleet.cargo.ironium;
    const totalBora = current.surfaceBoraniumKt + fleet.cargo.boranium;
    const totalGerm = current.surfaceGermaniumKt + fleet.cargo.germanium;

    const maxAllowedFleetColonists = Math.max(0, Math.min(maxColonists, totalColonists - 2_500));
    const nextColonists = Math.max(
      0,
      Math.min(maxAllowedFleetColonists, Math.round(desiredFleetCargo.colonists)),
    );

    let nextIron = Math.max(0, Math.min(totalIron, Math.round(desiredFleetCargo.ironium)));
    let nextBora = Math.max(0, Math.min(totalBora, Math.round(desiredFleetCargo.boranium)));
    let nextGerm = Math.max(0, Math.min(totalGerm, Math.round(desiredFleetCargo.germanium)));

    const sumMin = nextIron + nextBora + nextGerm;
    if (sumMin > maxMineralsKt && sumMin > 0) {
      const ratio = maxMineralsKt / sumMin;
      nextIron = Math.floor(nextIron * ratio);
      nextBora = Math.floor(nextBora * ratio);
      nextGerm = Math.floor(nextGerm * ratio);
    }

    delta.populationAtCheckpoint = Math.max(2_500, Math.round(totalColonists - nextColonists));
    delta.surfaceIroniumKtAtCheckpoint = Number((totalIron - nextIron).toFixed(1));
    delta.surfaceBoraniumKtAtCheckpoint = Number((totalBora - nextBora).toFixed(1));
    delta.surfaceGermaniumKtAtCheckpoint = Number((totalGerm - nextGerm).toFixed(1));
    delta.lastCheckpointSimMs = simNowMs;

    fleet.cargo = {
      colonists: nextColonists,
      ironium: nextIron,
      boranium: nextBora,
      germanium: nextGerm,
    };

    this.addLog(
      `Cargo transfer complete for ${fleet.name} at ${delta.customName || base.name} (Pop: ${nextColonists.toLocaleString()}, Min: ${nextIron + nextBora + nextGerm} kT).`,
      "info",
      simNowMs,
    );
    this.saveToStorage();
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedSandboxState;
      this.simEpochBaseMs = parsed.simEpochBaseMs ?? parsed.simClockBaseMs ?? Date.now();
      this.simClockBaseMs = parsed.simClockBaseMs ?? Date.now();
      this.lastRealTimestampMs = Date.now();
      this.speedMultiplier = parsed.speedMultiplier ?? 15;
      this.nextFleetSeq = parsed.nextFleetSeq ?? 1;

      for (const d of parsed.deltas ?? []) {
        this.deltas.set(d.planetIdHex, d);
      }
      for (const f of parsed.fleets ?? []) {
        this.fleets.set(f.id, {
          id: f.id,
          name: f.name,
          owner: f.owner,
          ships: f.ships,
          cargo: f.cargo,
          fuelPct: f.fuelPct ?? 100,
          burnLevel: f.burnLevel ?? 5,
          burnMode: f.burnMode ?? "orbit",
          plannedRoute: (f.plannedRouteHexes ?? [])
            .map((h) => parseId(h))
            .filter((x): x is bigint => x !== null),
          queuedWaypoints: (f.queuedWaypointHexes ?? [])
            .map((h) => parseId(h))
            .filter((x): x is bigint => x !== null),
          slingshotsCompleted: f.slingshotsCompleted ?? 0,
          isDerelict: f.isDerelict ?? false,
          orbitTargetId: f.orbitTargetIdHex ? parseId(f.orbitTargetIdHex) : null,
          originX: BigInt(f.originX),
          originY: BigInt(f.originY),
          destX: BigInt(f.destX),
          destY: BigInt(f.destY),
          destTargetId: f.destTargetIdHex ? parseId(f.destTargetIdHex) : null,
          departureSimMs: f.departureSimMs,
          arrivalSimMs: f.arrivalSimMs,
        });
      }
      for (const s of parsed.scannedStarIdHexes ?? []) {
        this.scannedStars.add(s);
      }
      for (const sig of parsed.pendingSignals ?? []) {
        this.pendingSignals.set(sig.starIdHex, {
          starIdHex: sig.starIdHex,
          starName: sig.starName,
          sourceX: BigInt(sig.sourceX),
          sourceY: BigInt(sig.sourceY),
          receiverX: BigInt(sig.receiverX),
          receiverY: BigInt(sig.receiverY),
          emittedSimMs: sig.emittedSimMs,
          arrivalSimMs: sig.arrivalSimMs,
        });
      }
      this.logs = parsed.logs ?? [];
    } catch {
      // Ignore corrupt storage
    }
  }

  private saveToStorage(): void {
    try {
      const state: PersistedSandboxState = {
        simEpochBaseMs: this.simEpochBaseMs,
        simClockBaseMs: this.simClockBaseMs,
        lastRealTimestampMs: this.lastRealTimestampMs,
        speedMultiplier: this.speedMultiplier,
        nextFleetSeq: this.nextFleetSeq,
        deltas: Array.from(this.deltas.values()),
        fleets: Array.from(this.fleets.values()).map((f) => ({
          id: f.id,
          name: f.name,
          owner: f.owner,
          ships: f.ships,
          cargo: f.cargo,
          fuelPct: f.fuelPct,
          burnLevel: f.burnLevel,
          burnMode: f.burnMode,
          plannedRouteHexes: (f.plannedRoute ?? []).map((id) => formatId(id)),
          queuedWaypointHexes: (f.queuedWaypoints ?? []).map((id) => formatId(id)),
          slingshotsCompleted: f.slingshotsCompleted ?? 0,
          isDerelict: f.isDerelict,
          orbitTargetIdHex: f.orbitTargetId !== null ? formatId(f.orbitTargetId) : null,
          originX: f.originX.toString(),
          originY: f.originY.toString(),
          destX: f.destX.toString(),
          destY: f.destY.toString(),
          destTargetIdHex: f.destTargetId !== null ? formatId(f.destTargetId) : null,
          departureSimMs: f.departureSimMs,
          arrivalSimMs: f.arrivalSimMs,
        })),
        scannedStarIdHexes: Array.from(this.scannedStars),
        pendingSignals: Array.from(this.pendingSignals.values()).map((sig) => ({
          starIdHex: sig.starIdHex,
          starName: sig.starName,
          sourceX: sig.sourceX.toString(),
          sourceY: sig.sourceY.toString(),
          receiverX: sig.receiverX.toString(),
          receiverY: sig.receiverY.toString(),
          emittedSimMs: sig.emittedSimMs,
          arrivalSimMs: sig.arrivalSimMs,
        })),
        logs: this.logs,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }
}

export const deltaStore = new SandboxStore();
