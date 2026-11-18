import {
  CELL_SIZE_METERS,
  formatId,
  GALAXY_RADIUS_LY,
  getCellStars,
  getPlanetPositionMeters,
  getPlanetsForStar,
  getStarById,
  getSuperBlockStars,
  METERS_PER_AU,
  METERS_PER_LIGHT_YEAR,
  parseId,
  PlanetData,
  StarData,
  unpackId,
} from "./galaxy";
import { BUILD_CATALOG, BuildableType, deltaStore, Fleet } from "./deltas";

const canvas = document.getElementById("galaxy-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const hudCoords = document.getElementById("hud-coords")!;
const hudCell = document.getElementById("hud-cell")!;
const inspectorContent = document.getElementById("inspector-content")!;
const fleetOutliner = document.getElementById("fleet-outliner")!;
const eventLogPanel = document.getElementById("event-log-panel")!;
const inputIdJump = document.getElementById("input-id-jump") as HTMLInputElement;

// Camera state: 128-bit integer meter coordinates + zoom scale (meters per pixel)
let camX: bigint = 21_500n * METERS_PER_LIGHT_YEAR;
let camY: bigint = 10_200n * METERS_PER_LIGHT_YEAR;
let metersPerPixel = 1.4e14; // Start in Nursery Sector View (~15 ly across screen)

// Selection & tracking state
let selectedStar: StarData | null = null;
let selectedPlanetIndex = 0; // 0 = Star itself, 1..N = Planet
let selectedFleetId: string | null = null;
let lockToPlanet = false;
let lockToFleet = false;

// Screen-space hit targets populated each frame for click/right-click picking
interface HitTarget {
  screenX: number;
  screenY: number;
  hitRadius: number;
  star: StarData;
  planetIndex: number; // 0 for star, 1..N for planet
  fleetId?: string;
}
let frameHitTargets: HitTarget[] = [];

function findDefaultHomeStar(): StarData {
  // Outer Rim / Orion Spur nursery (~23,800 ly from core) where stellar density is sparser
  const startCx = 21500;
  const startCy = 10200;
  for (let r = 0; r < 25; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const stars = getCellStars(startCx + dx, startCy + dy);
        if (stars.length > 0 && stars[0].planetCount >= 3) {
          return stars[0];
        }
      }
    }
  }
  return getCellStars(8500, 3200)[0];
}

function initSandbox(): void {
  const homeStar = findDefaultHomeStar();
  if (deltaStore.getAllDeltas().length === 0) {
    deltaStore.initNewGame(homeStar);
  }

  selectedStar = homeStar;
  selectedPlanetIndex = Math.min(2, homeStar.planetCount);
  const firstFleet = deltaStore.getAllFleets().find((f) => f.owner === "Player");
  selectedFleetId = firstFleet ? firstFleet.id : null;

  camX = homeStar.xMeters;
  camY = homeStar.yMeters;
  inputIdJump.value = formatId(homeStar.id);
  updateSpeedButtonsUI();
}

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function worldToScreen(wx: bigint, wy: bigint, width: number, height: number): [number, number] {
  const dxMeters = wx - camX;
  const dyMeters = wy - camY;
  const sx = width * 0.5 + Number(dxMeters) / metersPerPixel;
  const sy = height * 0.5 + Number(dyMeters) / metersPerPixel;
  return [sx, sy];
}

function formatMetersBigInt(m: bigint): string {
  const sign = m < 0n ? "-" : "+";
  const abs = m < 0n ? -m : m;
  const s = abs.toString();
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.push(s.slice(Math.max(0, i - 3), i));
  }
  return sign + parts.reverse().join(",") + " m";
}

function formatScale(mpp: number): string {
  if (mpp >= Number(METERS_PER_LIGHT_YEAR) * 0.1) {
    return `${(mpp / Number(METERS_PER_LIGHT_YEAR)).toFixed(2)} ly/px`;
  }
  if (mpp >= Number(METERS_PER_AU) * 0.05) {
    return `${(mpp / Number(METERS_PER_AU)).toFixed(3)} AU/px`;
  }
  if (mpp >= 1_000_000) {
    return `${(mpp / 1_000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km/px`;
  }
  if (mpp >= 1_000) {
    return `${(mpp / 1_000).toFixed(2)} km/px`;
  }
  return `${mpp.toFixed(2)} m/px`;
}

// Mouse Pan, Left-Click Select, Right-Click Waypoint Order
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = 0;

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragMoved = 0;
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dxPx = e.clientX - dragStartX;
  const dyPx = e.clientY - dragStartY;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragMoved += Math.hypot(dxPx, dyPx);

  if (dragMoved > 3 && (lockToPlanet || lockToFleet)) {
    lockToPlanet = false;
    lockToFleet = false;
    renderUI();
  }

  if (metersPerPixel >= 1) {
    camX += BigInt(Math.round(-dxPx * metersPerPixel));
    camY += BigInt(Math.round(-dyPx * metersPerPixel));
  } else {
    camX += BigInt(Math.round(-dxPx));
    camY += BigInt(Math.round(-dyPx));
  }
});

window.addEventListener("mouseup", (e) => {
  if (e.button !== 0 || !isDragging) return;
  isDragging = false;
  if (dragMoved < 5) {
    handleCanvasClick(e.clientX, e.clientY, false, e.shiftKey);
  }
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  handleCanvasClick(e.clientX, e.clientY, true, e.shiftKey);
});

canvas.addEventListener("dblclick", (e) => {
  const best = pickTargetAt(e.clientX, e.clientY);
  if (best) {
    selectedStar = best.star;
    selectedPlanetIndex = best.planetIndex;
    lockToFleet = false;
    lockToPlanet = false;
    // Toggle between Sector View (15 ly) and Solar System View (8 AU) on double-click!
    if (metersPerPixel > 2e11) {
      camX = best.star.xMeters;
      camY = best.star.yMeters;
      metersPerPixel = 1.6e9; // 8 AU System View
    } else {
      camX = best.star.xMeters;
      camY = best.star.yMeters;
      metersPerPixel = 1.4e14; // 15 ly Sector View
    }
    renderUI();
  }
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    // Normal scroll: gentle ~8.5% per tick for fine control over a handful of systems.
    // Hold Shift + Scroll for fast macro zoom across orders of magnitude!
    const step = e.shiftKey ? 1.38 : 1.085;
    const zoomFactor = e.deltaY > 0 ? step : 1 / step;
    const nextMpp = Math.max(0.5, Math.min(2.5e18, metersPerPixel * zoomFactor));

    if (!lockToPlanet && !lockToFleet) {
      const offsetX = e.clientX - window.innerWidth * 0.5;
      const offsetY = e.clientY - window.innerHeight * 0.5;
      camX += BigInt(Math.round(offsetX * (metersPerPixel - nextMpp)));
      camY += BigInt(Math.round(offsetY * (metersPerPixel - nextMpp)));
    }

    metersPerPixel = nextMpp;
  },
  { passive: false },
);

function pickTargetAt(clientX: number, clientY: number): HitTarget | null {
  let best: HitTarget | null = null;
  let bestDist = Infinity;

  for (const target of frameHitTargets) {
    const d = Math.hypot(clientX - target.screenX, clientY - target.screenY);
    if (d <= target.hitRadius && d < bestDist) {
      best = target;
      bestDist = d;
    }
  }
  return best;
}

function handleCanvasClick(
  clientX: number,
  clientY: number,
  isRightClick: boolean,
  isShiftKey = false,
): void {
  const best = pickTargetAt(clientX, clientY);
  if (!best) return;

  const simNow = deltaStore.getSimNowMs();

  if (isRightClick) {
    if (!selectedFleetId) return;
    const fleet = deltaStore.getFleetById(selectedFleetId);
    if (!fleet) return;

    const targetId =
      best.planetIndex === 0
        ? best.star.id
        : getPlanetsForStar(best.star)[best.planetIndex - 1]?.id ?? best.star.id;

    // Shift+Right-Click (or Right-Click when a multi-waypoint route is already open) adds to the route planner!
    if (isShiftKey || (fleet.plannedRoute && fleet.plannedRoute.length > 0)) {
      deltaStore.addWaypointToFleetRoute(selectedFleetId, targetId);
    } else {
      deltaStore.orderFleetToTarget(selectedFleetId, targetId, simNow);
    }
    renderUI();
    return;
  }

  if (best.fleetId) {
    selectedFleetId = best.fleetId;
    renderUI();
    return;
  }

  selectedStar = best.star;
  selectedPlanetIndex = best.planetIndex;
  const activeId =
    best.planetIndex === 0
      ? best.star.id
      : getPlanetsForStar(best.star)[best.planetIndex - 1]?.id ?? best.star.id;
  inputIdJump.value = formatId(activeId);
  renderUI();
}

export type OverlayMode =
  | "normal"
  | "habitability"
  | "conc_iron"
  | "conc_bora"
  | "conc_germ"
  | "abundance";

let activeOverlay: OverlayMode = "normal";
let debugRevealAll = false;

function isStarRevealed(starId: bigint): boolean {
  return debugRevealAll || deltaStore.isStarScanned(starId);
}

// Top Bar Controls
const btnDebugReveal = document.getElementById("btn-debug-reveal") as HTMLButtonElement;
btnDebugReveal.addEventListener("click", () => {
  debugRevealAll = !debugRevealAll;
  btnDebugReveal.textContent = `Debug Reveal: ${debugRevealAll ? "ON" : "OFF"}`;
  btnDebugReveal.classList.toggle("success", debugRevealAll);
  renderUI();
});
function updateSpeedButtonsUI(): void {
  const cur = deltaStore.getSpeedMultiplier();
  document.querySelectorAll<HTMLButtonElement>("#speed-buttons button[data-speed]").forEach((btn) => {
    const sp = Number(btn.dataset.speed);
    btn.classList.toggle("primary", sp === cur);
  });
}

document.querySelectorAll<HTMLButtonElement>("#speed-buttons button[data-speed]").forEach((btn) => {
  btn.addEventListener("click", () => {
    deltaStore.setSpeedMultiplier(Number(btn.dataset.speed));
    updateSpeedButtonsUI();
  });
});

document.querySelectorAll<HTMLButtonElement>("#overlay-buttons button[data-overlay]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeOverlay = btn.dataset.overlay as OverlayMode;
    document
      .querySelectorAll<HTMLButtonElement>("#overlay-buttons button[data-overlay]")
      .forEach((b) => b.classList.toggle("primary", b.dataset.overlay === activeOverlay));
  });
});

interface SystemOverlayResult {
  isKnown: boolean;
  /** 0..1 normalized strength for scaling ring radius & halo alpha */
  normalized: number;
  ringColor: string;
  fillColor: string;
  label: string;
}

/**
 * Computes a system's non-diminishing, multi-planet score for the active map overlay mode.
 *
 * Key design rule:
 * - Bad planets NEVER penalize or average down a system (`Math.max(0, ...)`).
 * - A system with one great planet (e.g. 80% habitability) scores high on its own.
 * - A system with multiple good planets (e.g. three 60% planets = 180 pts) compounds additively
 *   and scores significantly higher than a single 80% planet.
 */
function evaluateSystemOverlay(
  star: StarData,
  mode: OverlayMode,
  simNowMs: number,
): SystemOverlayResult {
  const planets = getPlanetsForStar(star);
  const isScanned = isStarRevealed(star.id);

  if (!isScanned) {
    return {
      isKnown: false,
      normalized: 0,
      ringColor: "rgba(120, 135, 165, 0.35)",
      fillColor: "rgba(120, 135, 165, 0.05)",
      label: "?",
    };
  }

  if (mode === "habitability") {
    let positiveHabSum = 0;
    let habPlanetCount = 0;
    let bestHab = -100;

    for (const p of planets) {
      const ev = deltaStore.evaluate(p, simNowMs);
      const h = ev.effectiveHabitabilityPct;
      if (h > bestHab) bestHab = h;
      if (h > 0) {
        positiveHabSum += h;
        habPlanetCount++;
      }
    }

    if (positiveHabSum <= 0) {
      return {
        isKnown: true,
        normalized: 0,
        ringColor: "rgba(255, 93, 93, 0.45)",
        fillColor: "rgba(255, 93, 93, 0.08)",
        label: `${bestHab}%`,
      };
    }

    // 80 pts (e.g. one 80% planet) -> ~0.48 normalized; 180 pts (three 60% planets) -> ~0.88 normalized
    const normalized = Math.min(1, Math.pow(positiveHabSum / 210, 0.78));
    return {
      isKnown: true,
      normalized,
      ringColor: "#3ddc97",
      fillColor: "rgba(61, 220, 151, 0.22)",
      label: `+${positiveHabSum}% (${habPlanetCount}p, max ${bestHab}%)`,
    };
  }

  if (mode === "conc_iron" || mode === "conc_bora" || mode === "conc_germ") {
    let qualitySum = 0;
    let bestConc = 0;
    let richCount = 0;

    for (const p of planets) {
      const conc =
        mode === "conc_iron"
          ? p.ironiumConc
          : mode === "conc_bora"
            ? p.boraniumConc
            : p.germaniumConc;
      if (conc > bestConc) bestConc = conc;
      // Only planets above 30% concentration contribute so poor rocks never inflate or diminish
      if (conc > 30) {
        qualitySum += conc - 30;
        if (conc >= 50) richCount++;
      }
    }

    const color =
      mode === "conc_iron" ? "#4da6ff" : mode === "conc_bora" ? "#3ddc97" : "#ffbe55";
    const fill =
      mode === "conc_iron"
        ? "rgba(77, 166, 255, 0.22)"
        : mode === "conc_bora"
          ? "rgba(61, 220, 151, 0.22)"
          : "rgba(255, 190, 85, 0.22)";
    const prefix = mode === "conc_iron" ? "Fe" : mode === "conc_bora" ? "Bo" : "Ge";

    // One 85% planet -> 55 pts (~0.44); Three 65% planets -> 105 pts (~0.75)
    const normalized = qualitySum <= 0 ? 0 : Math.min(1, Math.pow(qualitySum / 155, 0.8));
    return {
      isKnown: true,
      normalized,
      ringColor: color,
      fillColor: fill,
      label: `${prefix} max ${bestConc}% (${richCount} rich)`,
    };
  }

  // mode === "abundance" (Surface Mineral Stockpiles in kT)
  let totalSurfaceKt = 0;
  let scoreKt = 0;
  for (const p of planets) {
    const ev = deltaStore.evaluate(p, simNowMs);
    const pKt = Math.round(ev.surfaceIroniumKt + ev.surfaceBoraniumKt + ev.surfaceGermaniumKt);
    totalSurfaceKt += pKt;
    // Count everything above a minimal 200 kT baseline so rich worlds compound strongly
    if (pKt > 200) {
      scoreKt += pKt - 200;
    }
  }

  const normalized = scoreKt <= 0 ? 0.05 : Math.min(1, Math.pow(scoreKt / 6500, 0.75));
  return {
    isKnown: true,
    normalized,
    ringColor: "#c084fc",
    fillColor: "rgba(192, 132, 252, 0.22)",
    label: `${totalSurfaceKt.toLocaleString()} kT`,
  };
}

document.getElementById("btn-new-game")!.addEventListener("click", () => {
  const homeStar = findDefaultHomeStar();
  deltaStore.initNewGame(homeStar);
  selectedStar = homeStar;
  selectedPlanetIndex = Math.min(2, homeStar.planetCount);
  const firstFleet = deltaStore.getAllFleets().find((f) => f.owner === "Player");
  selectedFleetId = firstFleet ? firstFleet.id : null;
  lockToPlanet = false;
  lockToFleet = false;
  camX = homeStar.xMeters;
  camY = homeStar.yMeters;
  metersPerPixel = 1.4e14;
  renderUI();
});

document.getElementById("btn-zoom-galaxy")!.addEventListener("click", () => {
  lockToPlanet = false;
  lockToFleet = false;
  camX = 0n;
  camY = 0n;
  metersPerPixel = 1.25e18;
  renderUI();
});

document.getElementById("btn-zoom-sector")!.addEventListener("click", () => {
  lockToPlanet = false;
  lockToFleet = false;
  if (selectedStar) {
    camX = selectedStar.xMeters;
    camY = selectedStar.yMeters;
  }
  metersPerPixel = 1.4e14;
  renderUI();
});

document.getElementById("btn-zoom-system")!.addEventListener("click", () => {
  lockToPlanet = false;
  lockToFleet = false;
  if (selectedStar) {
    camX = selectedStar.xMeters;
    camY = selectedStar.yMeters;
  }
  metersPerPixel = 1.6e9;
  renderUI();
});

document.getElementById("btn-zoom-tactical")!.addEventListener("click", () => {
  if (!selectedStar) return;
  if (selectedPlanetIndex === 0) selectedPlanetIndex = 1;
  lockToFleet = false;
  lockToPlanet = true;
  metersPerPixel = 1.0;
  renderUI();
});

function jumpToId(id: bigint): void {
  const { cellX, cellY, planetIndex } = unpackId(id);
  const star = getStarById(id);
  if (!star) {
    camX = BigInt(cellX) * CELL_SIZE_METERS + CELL_SIZE_METERS / 2n;
    camY = BigInt(cellY) * CELL_SIZE_METERS + CELL_SIZE_METERS / 2n;
    metersPerPixel = 1.4e14;
    return;
  }

  selectedStar = star;
  const planets = getPlanetsForStar(star);
  if (planetIndex >= 1 && planetIndex <= planets.length) {
    selectedPlanetIndex = planetIndex;
    const p = planets[planetIndex - 1];
    const pos = getPlanetPositionMeters(star, p, deltaStore.getSimNowMs());
    camX = pos.xMeters;
    camY = pos.yMeters;
    if (metersPerPixel > 2e9) metersPerPixel = 1.2e9;
  } else {
    selectedPlanetIndex = 0;
    lockToPlanet = false;
    lockToFleet = false;
    camX = star.xMeters;
    camY = star.yMeters;
    if (metersPerPixel > 2e14) metersPerPixel = 1.8e9;
  }
  inputIdJump.value = formatId(id);
  renderUI();
}

document.getElementById("btn-id-jump")!.addEventListener("click", () => {
  const parsed = parseId(inputIdJump.value);
  if (parsed !== null) jumpToId(parsed);
});

inputIdJump.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const parsed = parseId(inputIdJump.value);
    if (parsed !== null) jumpToId(parsed);
  }
});

function formatShipSummary(f: Fleet): string {
  const parts: string[] = [];
  if (f.ships.scout > 0) parts.push(`${f.ships.scout} Scout`);
  if (f.ships.colony > 0) parts.push(`${f.ships.colony} Colony`);
  if (f.ships.freighter > 0) parts.push(`${f.ships.freighter} Freight`);
  if (f.ships.destroyer > 0) parts.push(`${f.ships.destroyer} DD`);
  const shipStr = parts.join(", ") || "Empty";

  const totalMin = f.cargo.ironium + f.cargo.boranium + f.cargo.germanium;
  const cargoParts: string[] = [];
  if (f.cargo.colonists > 0) cargoParts.push(`${(f.cargo.colonists / 1000).toFixed(0)}k Pop`);
  if (totalMin > 0) cargoParts.push(`${totalMin}kT Min`);
  return cargoParts.length > 0 ? `${shipStr} [${cargoParts.join(", ")}]` : shipStr;
}

function renderLeftSidebar(simNowMs: number): void {
  const fleets = deltaStore.getAllFleets();
  const playerFleets = fleets.filter((f) => f.owner === "Player");
  const allDeltas = deltaStore.getAllDeltas();

  const knownDeltas = allDeltas.filter(({ id, delta }) => {
    if (delta.owner === "Player") return true;
    const star = getStarById(id);
    return star ? isStarRevealed(star.id) : false;
  });

  fleetOutliner.innerHTML = `
    <h3>Your Fleets (${playerFleets.length}) — Click to Select</h3>
    <div class="planet-list" style="margin-bottom: 10px;">
      ${playerFleets
        .map((f) => {
          const isSel = f.id === selectedFleetId;
          const pwr = deltaStore.getFleetPowerState(f, simNowMs);
          let statusLabel = "In Orbit";
          if (!pwr.isPowered) {
            statusLabel = "Derelict (0% Pwr)";
          } else if (f.orbitTargetId === null) {
            if (f.destTargetId === null && f.burnMode === "flyby") {
              statusLabel = "Coasting (Flyby)";
            } else {
              const remSec = Math.max(0, Math.ceil((f.arrivalSimMs - simNowMs) / 1000));
              statusLabel = `Coasting (${remSec}s)`;
            }
          }
          const fuelColor =
            f.fuelPct >= 50
              ? "var(--accent-green)"
              : f.fuelPct >= 15
                ? "var(--accent-amber)"
                : "var(--accent-red)";
          const pwrColor =
            pwr.powerPct >= 60
              ? "var(--accent)"
              : pwr.powerPct > 0
                ? "var(--accent-amber)"
                : "var(--accent-red)";
          return `
            <div class="planet-row ${isSel ? "selected" : ""}" data-fleetid="${f.id}">
              <div>
                <strong>${f.name}</strong>
                <div style="font-size: 10px; color: var(--muted);">
                  ${formatShipSummary(f)} &bull; <span class="mono" style="color: ${fuelColor};">Fuel:${Math.round(f.fuelPct)}%</span> &bull; <span class="mono" style="color: ${pwrColor};">Pwr:${pwr.powerPct}%</span>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <span class="badge ${!pwr.isPowered ? "enemy" : f.orbitTargetId === null ? "fow" : "proc"}">${statusLabel}</span>
                <button data-focusfleet="${f.id}" title="Center Camera on Fleet" style="padding: 2px 5px;">&#8982;</button>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>

    <h3>Known Colonies (${knownDeltas.length})</h3>
    <div class="planet-list">
      ${knownDeltas
        .map(({ id, delta }) => {
          const isPlayer = delta.owner === "Player";
          return `
            <div class="planet-row" data-jumpid="${delta.planetIdHex}">
              <div>
                <strong>${delta.customName || formatId(id).slice(0, 12)}</strong>
                <div style="font-size: 10px; color: var(--muted);">${delta.mines}M / ${delta.factories}F ${delta.hasStarbase ? "&bull; ★ Starbase" : ""}</div>
              </div>
              <span class="badge ${isPlayer ? "delta" : "enemy"}">${delta.owner}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  fleetOutliner.querySelectorAll<HTMLElement>("[data-fleetid]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).dataset.focusfleet) return;
      selectedFleetId = el.dataset.fleetid || null;
      renderUI();
    });
  });

  fleetOutliner.querySelectorAll<HTMLElement>("[data-focusfleet]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const fid = el.dataset.focusfleet!;
      selectedFleetId = fid;
      const fleet = deltaStore.getFleetById(fid);
      if (fleet) {
        const pos = deltaStore.getFleetPositionMeters(fleet, deltaStore.getSimNowMs());
        camX = pos.xMeters;
        camY = pos.yMeters;
        lockToFleet = true;
        lockToPlanet = false;
      }
      renderUI();
    });
  });

  fleetOutliner.querySelectorAll<HTMLElement>("[data-jumpid]").forEach((el) => {
    el.addEventListener("click", () => {
      const parsed = parseId(el.dataset.jumpid || "");
      if (parsed !== null) jumpToId(parsed);
    });
  });

  const logs = deltaStore.getLogs();
  eventLogPanel.innerHTML = `
    <h3>Sector Telemetry &amp; Combat Log</h3>
    <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
      ${logs
        .map((l) => {
          const color =
            l.type === "combat"
              ? "var(--accent-red)"
              : l.type === "colony"
                ? "var(--accent-green)"
                : "var(--text)";
          return `<div style="color: ${color}; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 3px;">&bull; ${l.message}</div>`;
        })
        .join("")}
    </div>
  `;
}

function renderInspector(simNowMs: number): void {
  if (!selectedStar) {
    inspectorContent.innerHTML = `<div style="color: var(--muted)">Click any star or planet to inspect.</div>`;
    return;
  }

  const star = selectedStar;
  const isScanned = isStarRevealed(star.id);
  const pendingSignal = deltaStore.getPendingSignal(star.id);
  const planets = getPlanetsForStar(star);
  const activePlanet: PlanetData | null =
    selectedPlanetIndex >= 1 && selectedPlanetIndex <= planets.length
      ? planets[selectedPlanetIndex - 1]
      : null;

  const activeFleet = selectedFleetId ? deltaStore.getFleetById(selectedFleetId) : undefined;
  const targetObjectId = activePlanet ? activePlanet.id : star.id;
  const targetLabel = activePlanet ? activePlanet.name : star.name;

  // Check if any player fleets are currently in orbit around `activePlanet`
  const orbitingPlayerFleets = activePlanet
    ? deltaStore
        .getAllFleets()
        .filter((f) => f.owner === "Player" && f.orbitTargetId === activePlanet.id)
    : [];

  let planetDetailHtml = "";
  if (activePlanet) {
    const state = deltaStore.evaluate(activePlanet, simNowMs);
    const pos = getPlanetPositionMeters(star, activePlanet, simNowMs);

    if (!isScanned && !state.isModified) {
      planetDetailHtml = `
        <div style="margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--border);">
          <h2>
            <span>${activePlanet.name}</span>
            <span class="badge fow">UNSCANNED FOG OF WAR</span>
          </h2>
          <div class="mono" style="font-size: 11px; color: var(--accent); margin: 4px 0 8px;">
            ID: ${formatId(activePlanet.id)}
          </div>
          <p style="font-size: 12px; color: var(--muted); margin-bottom: 10px;">
            Planetary habitability and mineral concentrations are unknown. Dispatch a <strong>Scout</strong> or fleet within scanner range to chart this system.
          </p>
          <div class="stat-grid">
            <div class="stat-item">
              <span class="hud-label">Orbit Radius</span>
              <span class="stat-val">${activePlanet.orbitRadiusAU} AU</span>
            </div>
            <div class="stat-item">
              <span class="hud-label">Orbital Speed</span>
              <span class="stat-val">${pos.orbitalSpeedMetersPerSec.toLocaleString()} m/s</span>
            </div>
          </div>
        </div>
      `;
    } else {
      const habColor =
        state.effectiveHabitabilityPct >= 50
          ? "var(--accent-green)"
          : state.effectiveHabitabilityPct > 0
            ? "var(--accent-amber)"
            : "var(--accent-red)";

      const colonizerFleet = orbitingPlayerFleets.find((f) => f.ships.colony > 0);
      const cargoCapableFleets = orbitingPlayerFleets.filter(
        (f) =>
          f.ships.colony > 0 ||
          f.ships.freighter > 0 ||
          f.cargo.ironium + f.cargo.boranium + f.cargo.germanium + f.cargo.colonists > 0,
      );

      planetDetailHtml = `
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
          <h2>
            <span>${state.displayName}</span>
            <span class="badge ${state.isModified ? (state.owner === "Player" ? "delta" : "enemy") : "proc"}">
              ${state.isModified ? `${state.owner?.toUpperCase()} COLONY` : "SCANNED / UNINHABITED"}
            </span>
          </h2>
          <div class="mono" style="font-size: 11px; color: var(--accent); margin: 3px 0 7px;">
            ID: ${formatId(activePlanet.id)}
          </div>

          <div class="btn-row" style="margin-bottom: 8px;">
            <button id="btn-focus-planet">Center on Planet</button>
            <button id="btn-lock-planet" class="${lockToPlanet ? "primary" : ""}">
              ${lockToPlanet ? "Locked to Orbit (ON)" : "Lock to 1m Orbit"}
            </button>
          </div>

          <h3>Real-Time 1-Meter Orbital Telemetry</h3>
          <div class="stat-grid" style="margin-bottom: 8px;">
            <div class="stat-item" style="grid-column: span 2;">
              <span class="hud-label">Global X / Y (Exact Meters)</span>
              <span class="stat-val" id="live-planet-xy" style="font-size: 11px;">
                ${formatMetersBigInt(pos.xMeters)} , ${formatMetersBigInt(pos.yMeters)}
              </span>
            </div>
            <div class="stat-item">
              <span class="hud-label">Habitability</span>
              <span class="stat-val" style="color: ${habColor}">${state.effectiveHabitabilityPct}% (${activePlanet.gravityG}g, ${activePlanet.temperatureC}&deg;C)</span>
            </div>
            <div class="stat-item">
              <span class="hud-label">Orbit / Speed</span>
              <span class="stat-val">${activePlanet.orbitRadiusAU} AU (${pos.orbitalSpeedMetersPerSec.toLocaleString()} m/s)</span>
            </div>
          </div>

          <h3>Minerals (Surface Stockpile + Concentration)</h3>
          <div style="display: flex; flex-direction: column; gap: 5px; font-size: 11px; margin-bottom: 10px;">
            <div>
              <div style="display: flex; justify-content: space-between;">
                <span><strong>Ironium</strong> (${activePlanet.ironiumConc}%)</span>
                <span class="mono" id="live-iron">${state.surfaceIroniumKt} kT ${state.ironiumMiningRatePerMin > 0 ? `(+${state.ironiumMiningRatePerMin}/m)` : ""}</span>
              </div>
              <div class="bar-wrap"><div class="bar-fill" style="width: ${activePlanet.ironiumConc}%; background: #4da6ff;"></div></div>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between;">
                <span><strong>Boranium</strong> (${activePlanet.boraniumConc}%)</span>
                <span class="mono" id="live-bora">${state.surfaceBoraniumKt} kT ${state.boraniumMiningRatePerMin > 0 ? `(+${state.boraniumMiningRatePerMin}/m)` : ""}</span>
              </div>
              <div class="bar-wrap"><div class="bar-fill" style="width: ${activePlanet.boraniumConc}%; background: #3ddc97;"></div></div>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between;">
                <span><strong>Germanium</strong> (${activePlanet.germaniumConc}%)</span>
                <span class="mono" id="live-germ">${state.surfaceGermaniumKt} kT ${state.germaniumMiningRatePerMin > 0 ? `(+${state.germaniumMiningRatePerMin}/m)` : ""}</span>
              </div>
              <div class="bar-wrap"><div class="bar-fill" style="width: ${activePlanet.germaniumConc}%; background: #ffbe55;"></div></div>
            </div>
          </div>

          ${
            !state.isModified
              ? `
                <h3>Colonization</h3>
                ${
                  colonizerFleet
                    ? colonizerFleet.cargo.colonists >= 2500
                      ? `<button id="btn-fleet-colonize" class="success" style="width: 100%; padding: 7px;">
                          Found Colony using ${colonizerFleet.name} (${colonizerFleet.cargo.colonists.toLocaleString()} Colonists)
                         </button>`
                      : `<p style="font-size: 11px; color: var(--accent-amber);">
                          <strong>${colonizerFleet.name}</strong> is in orbit with a Colony Ship, but has <strong>0 Colonists</strong> loaded! Return it to one of your colonies and click <em>+Load 25k Colonists</em>.
                         </p>`
                    : `<p style="font-size: 11px; color: var(--muted);">
                        To colonize this planet, send a fleet with a <strong>Colony Ship</strong> (carrying colonists) into orbit around it.
                       </p>`
                }
              `
              : state.owner === "Player"
                ? `
                  <h3>Colony Economy &amp; Production Queue</h3>
                  <div class="stat-grid" style="margin-bottom: 8px;">
                    <div class="stat-item">
                      <span class="hud-label">Population (Max ${(state.maxPopulation / 1000).toFixed(0)}k)</span>
                      <span class="stat-val" id="live-pop">${state.population.toLocaleString()} (+${state.populationGrowthPerMin}/m)</span>
                    </div>
                    <div class="stat-item">
                      <span class="hud-label">Industrial Output</span>
                      <span class="stat-val" style="color: var(--accent-green);">${state.resourcesPerMin} Res/min</span>
                    </div>
                    <div class="stat-item">
                      <span class="hud-label">Mines (Operable / Built)</span>
                      <span class="stat-val" style="color: ${state.operableMines < state.mines ? "var(--accent-amber)" : "var(--text)"};">
                        ${state.operableMines} / ${state.mines} <span style="font-size: 10px; color: var(--muted);">(Cap:${state.workerCapStructures})</span>
                      </span>
                    </div>
                    <div class="stat-item">
                      <span class="hud-label">Factories (Operable / Built)</span>
                      <span class="stat-val" style="color: ${state.operableFactories < state.factories ? "var(--accent-amber)" : "var(--text)"};">
                        ${state.operableFactories} / ${state.factories} <span style="font-size: 10px; color: var(--muted);">(Cap:${state.workerCapStructures})</span>
                      </span>
                    </div>
                  </div>

                  ${
                    cargoCapableFleets.length > 0
                      ? `
                      <h3>Orbiting Fleet Cargo &amp; Colonist Loading</h3>
                      <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px;">
                        ${cargoCapableFleets
                          .map((cf) => {
                            const cap = deltaStore.getFleetCargoCapacity(cf.ships);
                            const curMin = cf.cargo.ironium + cf.cargo.boranium + cf.cargo.germanium;
                            return `
                              <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 5px; padding: 6px; font-size: 11px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                  <strong>${cf.name}</strong>
                                  <span class="mono" style="color: var(--accent); font-size: 10px;">
                                    Pop: ${cf.cargo.colonists.toLocaleString()}/${cap.maxColonists.toLocaleString()} &bull; Min: ${curMin}/${cap.maxMineralsKt}kT
                                  </span>
                                </div>
                                <div class="btn-row">
                                  <button data-opencargomodal="${cf.id}" class="primary">
                                    Transfer Cargo (Sliders)...
                                  </button>
                                  <button data-cargofleet="${cf.id}" data-cargomode="load_colonists" ${cf.cargo.colonists >= cap.maxColonists ? "disabled" : ""}>
                                    +25k Pop
                                  </button>
                                  <button data-cargofleet="${cf.id}" data-cargomode="unload" ${cf.cargo.colonists + curMin === 0 ? "disabled" : ""}>
                                    Unload All
                                  </button>
                                </div>
                              </div>
                            `;
                          })
                          .join("")}
                      </div>
                    `
                      : ""
                  }

                  <div class="hud-label" style="margin-bottom: 4px;">Add to Build Queue:</div>
                  <div class="btn-row" style="margin-bottom: 6px;">
                    <button data-build="mine" title="Costs 5 Resources, 0 Minerals">+1 Mine (5R)</button>
                    <button data-build="factory" title="Costs 10 Resources + 4kT Germanium">+1 Factory (10R, 4Ge)</button>
                    ${!state.hasStarbase ? `<button data-build="starbase" class="primary">Build Starbase (100R)</button>` : `<span class="badge delta" style="align-self:center;">★ Starbase Active</span>`}
                  </div>
                  <div class="btn-row" style="margin-bottom: 8px;">
                    <button data-build="scout" ${!state.hasStarbase ? "disabled" : ""}>Scout (25R)</button>
                    <button data-build="colony" ${!state.hasStarbase ? "disabled" : ""}>Colony Ship (65R)</button>
                    <button data-build="freighter" ${!state.hasStarbase ? "disabled" : ""}>Freighter (45R)</button>
                    <button data-build="destroyer" ${!state.hasStarbase ? "disabled" : ""}>Destroyer (90R)</button>
                  </div>

                  <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 5px; padding: 6px; font-size: 11px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                      <span class="hud-label">Active Queue (${state.buildQueue.length})</span>
                      ${state.buildQueue.length > 0 ? `<button id="btn-clear-queue" style="padding: 1px 5px; font-size: 10px;">Clear</button>` : ""}
                    </div>
                    ${
                      state.buildQueue.length === 0
                        ? `<div style="color: var(--muted);">Queue idle. Add structures or ships above.</div>`
                        : state.buildQueue
                            .map((item, idx) => {
                              const spec = BUILD_CATALOG[item.type];
                              const pct =
                                idx === 0
                                  ? Math.min(100, Math.round((item.progressResources / spec.resources) * 100))
                                  : 0;
                              return `
                                <div style="margin-bottom: 4px;">
                                  <div style="display: flex; justify-content: space-between;">
                                    <span>${item.count}x <strong>${spec.label}</strong></span>
                                    <span class="mono">${idx === 0 ? `${Math.round(item.progressResources)}/${spec.resources}R (${pct}%)` : `${spec.resources}R each`}</span>
                                  </div>
                                  ${idx === 0 ? `<div class="bar-wrap"><div class="bar-fill" style="width: ${pct}%; background: var(--accent-green);"></div></div>` : ""}
                                </div>
                              `;
                            })
                            .join("")
                    }
                  </div>
                `
                : `
                  <p style="font-size: 11px; color: var(--accent-red);">
                    Hostile Xenon Colony (${state.population.toLocaleString()} pop, ${state.mines}M / ${state.factories}F). Send a fleet with <strong>Destroyers</strong> here to capture this world!
                  </p>
                `
          }
        </div>
      `;
    }
  }

  const signalRemSec = pendingSignal
    ? Math.max(0, Math.ceil((pendingSignal.arrivalSimMs - simNowMs) / 1000))
    : 0;

  inspectorContent.innerHTML = `
    <div>
      <h2>
        <span style="display: flex; align-items: center; gap: 7px;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${star.color};box-shadow:0 0 8px ${star.color}"></span>
          ${star.name} (${star.spectralClass}-Class)
        </span>
        <span class="badge ${isScanned ? "delta" : pendingSignal ? "proc" : "fow"}">
          ${isScanned ? "SCANNED" : pendingSignal ? `TELEMETRY IN TRANSIT (${signalRemSec}s)` : "UNSCANNED"}
        </span>
      </h2>
      <div class="mono" style="font-size: 11px; color: var(--accent); margin: 3px 0 7px;">
        Star ID: ${formatId(star.id)} &bull; Cell (${star.cellX}, ${star.cellY})
      </div>

      ${
        activeFleet
          ? (() => {
              const pwr = deltaStore.getFleetPowerState(activeFleet, simNowMs);
              const totalShips =
                activeFleet.ships.scout +
                activeFleet.ships.colony +
                activeFleet.ships.freighter +
                activeFleet.ships.destroyer;
              const coOrbitingCount =
                activeFleet.orbitTargetId !== null
                  ? deltaStore
                      .getAllFleets()
                      .filter(
                        (f) =>
                          f.owner === "Player" &&
                          f.id !== activeFleet.id &&
                          f.orbitTargetId === activeFleet.orbitTargetId,
                      ).length
                  : 0;

              const planned = activeFleet.plannedRoute ?? [];
              const hasPlannedRoute = planned.length > 0;
              const previewTargets = hasPlannedRoute ? planned : [targetObjectId];
              const routePlan = deltaStore.evaluateRoutePlan(
                activeFleet,
                previewTargets,
                simNowMs,
              );

              const fuelCostColor = routePlan.canAffordFuel
                ? "var(--accent-green)"
                : "var(--accent-red)";

              return `
          <div style="background: rgba(77, 166, 255, 0.08); border: 1px solid rgba(77, 166, 255, 0.35); border-radius: 6px; padding: 8px; margin-bottom: 9px; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="font-size: 11px;">
                <div class="hud-label">Gravity-Assist Route Planner &amp; Propulsion</div>
                <strong>${activeFleet.name}</strong>
              </div>
              <button id="btn-send-fleet-here" class="primary" ${!pwr.isPowered || !routePlan.canAffordFuel ? "disabled" : ""}>
                ${hasPlannedRoute ? `Launch Tour (${routePlan.totalFuelRequiredPct}% Fuel)` : `Launch (${routePlan.totalFuelRequiredPct}% Fuel)`}
              </button>
            </div>

            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--muted);">
              <span>Tank: <strong class="mono" style="color: var(--text);">${Math.round(activeFleet.fuelPct)}%</strong></span>
              <span>Plan Cost: <strong class="mono" style="color: ${fuelCostColor};">${routePlan.totalFuelRequiredPct}% Fuel</strong> (${routePlan.remainingFuelAfterPct}% left)</span>
            </div>

            <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--muted);">
              <span>Cruise: <strong class="mono" style="color: var(--accent);">${deltaStore.getFleetCruiseSpeedLyPerMin(activeFleet)} ly/m</strong></span>
              <span>ETA: <strong class="mono" style="color: var(--text);">${routePlan.totalEtaGameYears} yrs (${routePlan.totalEtaSimSeconds}s sim)</strong></span>
            </div>

            <!-- Burn Intensity Slider (1..10, like Stars! Warp 1..10) -->
            <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.07); border-radius: 5px; padding: 5px 7px;">
              <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
                <span class="hud-label">Thrust / Burn Intensity (1–10)</span>
                <strong class="mono" style="color: var(--accent);">Burn ${activeFleet.burnLevel ?? 5}</strong>
              </div>
              <input
                type="range"
                id="slider-burn-level"
                min="1"
                max="10"
                step="1"
                value="${activeFleet.burnLevel ?? 5}"
                title="Lower Burn = slower cruise, much lower fuel per star (visit more stars). Higher Burn = fast sprint, high fuel cost."
              />
              <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--muted);">
                <span>1: Max Range Drift</span>
                <span>5: Standard</span>
                <span>10: Max Overburn</span>
              </div>
            </div>

            <div class="btn-row">
              <button id="btn-mode-orbit" class="${activeFleet.burnMode === "orbit" ? "primary" : ""}" style="flex: 1;" title="Reserves braking fuel at the final waypoint to enter orbit">
                Final: Brake to Orbit (+${Math.max(4, Math.round(25 * deltaStore.getBurnFuelFactor(activeFleet.burnLevel ?? 5)))}% Fuel)
              </button>
              <button id="btn-mode-flyby" class="${activeFleet.burnMode === "flyby" ? "primary" : ""}" style="flex: 1;" title="0% braking fuel at final waypoint (1.65x speed, coasts into deep space)">
                Final: Flyby Coast (0% Brake)
              </button>
            </div>

            <!-- Route Legs & Fuel Breakdown -->
            <div style="background: rgba(0, 0, 0, 0.32); border: 1px solid var(--border); border-radius: 5px; padding: 6px; font-size: 10px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span class="hud-label">${hasPlannedRoute ? `Planned Tour (${planned.length} Stops)` : `Single-Target Fuel Preview`}</span>
                <div class="btn-row">
                  <button id="btn-route-add" style="padding: 1px 6px; font-size: 10px;" title="Append ${targetLabel} as a Gravity-Assist Waypoint (or Shift+Right-Click on map)">
                    + Add ${targetLabel}
                  </button>
                  ${hasPlannedRoute ? `<button id="btn-route-undo" style="padding: 1px 5px; font-size: 10px;">Undo</button>` : ""}
                  ${hasPlannedRoute ? `<button id="btn-route-clear" style="padding: 1px 5px; font-size: 10px;">Clear</button>` : ""}
                </div>
              </div>
              ${routePlan.legs
                .map(
                  (leg) => `
                  <div style="display: flex; justify-content: space-between; padding: 2px 0; border-top: 1px solid rgba(255,255,255,0.05);">
                    <span><strong>#${leg.legIndex} ${leg.targetName}</strong> (${leg.distLy} ly)</span>
                    <span class="mono" style="color: var(--accent-amber);">-${leg.legTotalFuelPct}% [${leg.maneuverLabel}]</span>
                  </div>
                `,
                )
                .join("")}
            </div>

            ${
              activeFleet.orbitTargetId !== null && (coOrbitingCount > 0 || totalShips > 1)
                ? `
              <div class="btn-row">
                <button id="btn-merge-fleets" ${coOrbitingCount === 0 ? "disabled" : ""}>
                  Merge Orbiting (${coOrbitingCount})
                </button>
                <button id="btn-split-fleet" ${totalShips <= 1 ? "disabled" : ""}>
                  Split into Individual Ships (${totalShips})
                </button>
              </div>
            `
                : ""
            }
          </div>
        `;
            })()
          : ""
      }

      <h3>Orbiting Planets (${planets.length})</h3>
      <div class="planet-list">
        ${planets
          .map((p) => {
            const ev = deltaStore.evaluate(p, simNowMs);
            const isSel = selectedPlanetIndex === p.planetIndex;
            const showStats = isScanned || ev.isModified;
            const habCol =
              ev.effectiveHabitabilityPct >= 50
                ? "var(--accent-green)"
                : ev.effectiveHabitabilityPct > 0
                  ? "var(--accent-amber)"
                  : "var(--accent-red)";
            return `
              <div class="planet-row ${isSel ? "selected" : ""}" data-pidx="${p.planetIndex}">
                <div>
                  <strong>${ev.displayName}</strong>
                  <span style="color: var(--muted); font-size: 10px; margin-left: 4px;">${p.orbitRadiusAU} AU</span>
                </div>
                <div style="display: flex; align-items: center; gap: 5px;">
                  ${ev.isModified ? `<span class="badge ${ev.owner === "Player" ? "delta" : "enemy"}">${ev.owner === "Player" ? "YOURS" : "XENON"}</span>` : ""}
                  <span class="mono" style="color: ${showStats ? habCol : "var(--muted)"}; font-size: 11px;">
                    ${showStats ? `${ev.effectiveHabitabilityPct}%` : "???%"}
                  </span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      ${planetDetailHtml}
    </div>
  `;

  // Wire up planet list clicks
  inspectorContent.querySelectorAll<HTMLElement>("[data-pidx]").forEach((el) => {
    el.addEventListener("click", () => {
      selectedPlanetIndex = Number(el.dataset.pidx);
      const p = planets[selectedPlanetIndex - 1];
      if (p) inputIdJump.value = formatId(p.id);
      renderUI();
    });
  });

  document.getElementById("btn-send-fleet-here")?.addEventListener("click", () => {
    if (selectedFleetId) {
      deltaStore.orderFleetToTarget(selectedFleetId, targetObjectId, deltaStore.getSimNowMs());
      renderUI();
    }
  });

  document.getElementById("btn-route-add")?.addEventListener("click", () => {
    if (selectedFleetId) {
      deltaStore.addWaypointToFleetRoute(selectedFleetId, targetObjectId);
      renderUI();
    }
  });

  document.getElementById("btn-route-undo")?.addEventListener("click", () => {
    if (selectedFleetId) {
      deltaStore.popFleetRouteWaypoint(selectedFleetId);
      renderUI();
    }
  });

  document.getElementById("btn-route-clear")?.addEventListener("click", () => {
    if (selectedFleetId) {
      deltaStore.clearFleetRoute(selectedFleetId);
      renderUI();
    }
  });

  const sliderBurnLevel = document.getElementById("slider-burn-level") as HTMLInputElement | null;
  sliderBurnLevel?.addEventListener("input", () => {
    if (selectedFleetId) {
      deltaStore.setFleetBurnLevel(selectedFleetId, Number(sliderBurnLevel.value));
      renderUI();
    }
  });

  document.getElementById("btn-mode-orbit")?.addEventListener("click", () => {
    if (selectedFleetId) {
      deltaStore.setFleetBurnMode(selectedFleetId, "orbit");
      renderUI();
    }
  });

  document.getElementById("btn-mode-flyby")?.addEventListener("click", () => {
    if (selectedFleetId) {
      deltaStore.setFleetBurnMode(selectedFleetId, "flyby");
      renderUI();
    }
  });

  document.getElementById("btn-merge-fleets")?.addEventListener("click", () => {
    if (selectedFleetId) {
      deltaStore.mergeOrbitingFleets(selectedFleetId);
      renderUI();
    }
  });

  document.getElementById("btn-split-fleet")?.addEventListener("click", () => {
    if (selectedFleetId) {
      deltaStore.splitFleet(selectedFleetId, deltaStore.getSimNowMs());
      renderUI();
    }
  });

  if (activePlanet) {
    document.getElementById("btn-focus-planet")?.addEventListener("click", () => {
      const pos = getPlanetPositionMeters(star, activePlanet, deltaStore.getSimNowMs());
      camX = pos.xMeters;
      camY = pos.yMeters;
      lockToFleet = false;
      if (metersPerPixel > 1e9) metersPerPixel = 5e8;
    });

    document.getElementById("btn-lock-planet")?.addEventListener("click", () => {
      lockToPlanet = !lockToPlanet;
      if (lockToPlanet) lockToFleet = false;
      renderUI();
    });

    document.getElementById("btn-fleet-colonize")?.addEventListener("click", () => {
      const colonizer = orbitingPlayerFleets.find(
        (f) => f.ships.colony > 0 && f.cargo.colonists >= 2500,
      );
      if (colonizer) {
        deltaStore.colonizeWithFleet(colonizer.id, activePlanet, deltaStore.getSimNowMs());
        renderUI();
      }
    });

    inspectorContent.querySelectorAll<HTMLButtonElement>("[data-opencargomodal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fid = btn.dataset.opencargomodal!;
        openCargoModal(fid, activePlanet);
      });
    });

    inspectorContent.querySelectorAll<HTMLButtonElement>("[data-cargofleet]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fid = btn.dataset.cargofleet!;
        const mode = btn.dataset.cargomode as "load_colonists" | "load_minerals" | "unload";
        deltaStore.transferCargo(fid, activePlanet, mode, deltaStore.getSimNowMs());
        renderUI();
      });
    });

    inspectorContent.querySelectorAll<HTMLButtonElement>("[data-build]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const bType = btn.dataset.build as BuildableType;
        deltaStore.enqueueBuildItem(activePlanet, bType, 1, deltaStore.getSimNowMs());
        renderUI();
      });
    });

    document.getElementById("btn-clear-queue")?.addEventListener("click", () => {
      deltaStore.clearBuildQueue(activePlanet);
      renderUI();
    });
  }
}

function renderUI(): void {
  const simNow = deltaStore.getSimNowMs();
  renderLeftSidebar(simNow);
  renderInspector(simNow);
}

const cargoModalBackdrop = document.getElementById("cargo-modal-backdrop")!;
const cargoModalContent = document.getElementById("cargo-modal-content")!;

function closeCargoModal(): void {
  cargoModalBackdrop.classList.remove("open");
}

cargoModalBackdrop.addEventListener("click", (e) => {
  if (e.target === cargoModalBackdrop) closeCargoModal();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && cargoModalBackdrop.classList.contains("open")) {
    closeCargoModal();
  }
});

function openCargoModal(fleetId: string, planet: PlanetData): void {
  const fleet = deltaStore.getFleetById(fleetId);
  if (!fleet) return;

  const simNow = deltaStore.getSimNowMs();
  const state = deltaStore.evaluate(planet, simNow);
  if (!state.isModified || state.owner !== "Player") return;

  const cap = deltaStore.getFleetCargoCapacity(fleet.ships);
  const MIN_COLONY_POP = 2_500;

  // Conserved pools between the ship/flotilla and the colony
  const totalColonists = state.population + fleet.cargo.colonists;
  const totalIron = Math.floor(state.surfaceIroniumKt) + fleet.cargo.ironium;
  const totalBora = Math.floor(state.surfaceBoraniumKt) + fleet.cargo.boranium;
  const totalGerm = Math.floor(state.surfaceGermaniumKt) + fleet.cargo.germanium;

  const maxShipColonists = Math.max(0, Math.min(cap.maxColonists, totalColonists - MIN_COLONY_POP));

  // Draft values on the ship (left side); colony (right side) is always `total - draftShip`
  const draftShip = {
    colonists: Math.min(maxShipColonists, fleet.cargo.colonists),
    ironium: fleet.cargo.ironium,
    boranium: fleet.cargo.boranium,
    germanium: fleet.cargo.germanium,
  };

  cargoModalContent.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
      <div>
        <div class="hud-label">Orbital Logistics &amp; Resource Transfer</div>
        <h2 style="font-size: 16px; margin-top: 2px;">${fleet.name} &harr; ${state.displayName}</h2>
      </div>
      <span class="badge proc">${formatShipSummary(fleet)}</span>
    </div>

    <div class="cargo-columns">
      <!-- LEFT COLUMN: SHIP / FLOTILLA -->
      <div class="cargo-col">
        <h3>Ship / Flotilla Hold (Left)</h3>
        <div style="font-size: 11px; display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px;">
          <div style="display: flex; justify-content: space-between;">
            <span class="hud-label">Colonist Berths</span>
            <span class="mono" id="modal-cap-pop">0 / ${cap.maxColonists.toLocaleString()}</span>
          </div>
          <div class="bar-wrap"><div class="bar-fill" id="modal-bar-pop" style="width: 0%; background: var(--accent-green);"></div></div>
          <div style="display: flex; justify-content: space-between; margin-top: 3px;">
            <span class="hud-label">Mineral Cargo Hold</span>
            <span class="mono" id="modal-cap-min">0 / ${cap.maxMineralsKt} kT</span>
          </div>
          <div class="bar-wrap"><div class="bar-fill" id="modal-bar-min" style="width: 0%; background: var(--accent);"></div></div>
        </div>

        <div class="slider-row">
          <div class="slider-header">
            <span><strong>Colonists</strong> (Aboard Ship)</span>
            <span class="mono" id="val-ship-pop">0</span>
          </div>
          <input type="range" id="slider-ship-pop" min="0" max="${maxShipColonists}" step="100" />
        </div>

        <div class="slider-row">
          <div class="slider-header">
            <span style="color: #4da6ff;"><strong>Ironium</strong> (Aboard Ship)</span>
            <span class="mono" id="val-ship-iron">0 kT</span>
          </div>
          <input type="range" id="slider-ship-iron" min="0" max="${Math.min(totalIron, cap.maxMineralsKt)}" step="1" />
        </div>

        <div class="slider-row">
          <div class="slider-header">
            <span style="color: #3ddc97;"><strong>Boranium</strong> (Aboard Ship)</span>
            <span class="mono" id="val-ship-bora">0 kT</span>
          </div>
          <input type="range" id="slider-ship-bora" min="0" max="${Math.min(totalBora, cap.maxMineralsKt)}" step="1" />
        </div>

        <div class="slider-row">
          <div class="slider-header">
            <span style="color: #ffbe55;"><strong>Germanium</strong> (Aboard Ship)</span>
            <span class="mono" id="val-ship-germ">0 kT</span>
          </div>
          <input type="range" id="slider-ship-germ" min="0" max="${Math.min(totalGerm, cap.maxMineralsKt)}" step="1" />
        </div>
      </div>

      <!-- RIGHT COLUMN: COLONY SUPPLY -->
      <div class="cargo-col">
        <h3>Colony Surface Supply (Right)</h3>
        <div style="font-size: 11px; color: var(--muted); margin-bottom: 10px; min-height: 38px; display: flex; align-items: center;">
          Adjusting either side automatically transfers resources between the ship and ${state.displayName}.
        </div>

        <div class="slider-row">
          <div class="slider-header">
            <span><strong>Colonists</strong> (On Colony)</span>
            <span class="mono" id="val-col-pop">0</span>
          </div>
          <input type="range" id="slider-col-pop" min="${MIN_COLONY_POP}" max="${totalColonists}" step="100" />
        </div>

        <div class="slider-row">
          <div class="slider-header">
            <span style="color: #4da6ff;"><strong>Ironium</strong> (On Colony)</span>
            <span class="mono" id="val-col-iron">0 kT</span>
          </div>
          <input type="range" id="slider-col-iron" min="0" max="${totalIron}" step="1" />
        </div>

        <div class="slider-row">
          <div class="slider-header">
            <span style="color: #3ddc97;"><strong>Boranium</strong> (On Colony)</span>
            <span class="mono" id="val-col-bora">0 kT</span>
          </div>
          <input type="range" id="slider-col-bora" min="0" max="${totalBora}" step="1" />
        </div>

        <div class="slider-row">
          <div class="slider-header">
            <span style="color: #ffbe55;"><strong>Germanium</strong> (On Colony)</span>
            <span class="mono" id="val-col-germ">0 kT</span>
          </div>
          <input type="range" id="slider-col-germ" min="0" max="${totalGerm}" step="1" />
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <div class="btn-row">
        <button id="btn-modal-fill-pop">Max Colonists</button>
        <button id="btn-modal-unload-all">Unload All to Colony</button>
      </div>
      <div class="btn-row">
        <button id="btn-modal-cancel">Cancel</button>
        <button id="btn-modal-ok" class="primary" style="padding: 6px 16px;">OK</button>
      </div>
    </div>
  `;

  const sShipPop = document.getElementById("slider-ship-pop") as HTMLInputElement;
  const sShipIron = document.getElementById("slider-ship-iron") as HTMLInputElement;
  const sShipBora = document.getElementById("slider-ship-bora") as HTMLInputElement;
  const sShipGerm = document.getElementById("slider-ship-germ") as HTMLInputElement;

  const sColPop = document.getElementById("slider-col-pop") as HTMLInputElement;
  const sColIron = document.getElementById("slider-col-iron") as HTMLInputElement;
  const sColBora = document.getElementById("slider-col-bora") as HTMLInputElement;
  const sColGerm = document.getElementById("slider-col-germ") as HTMLInputElement;

  function syncSlidersUI(): void {
    const colPop = totalColonists - draftShip.colonists;
    const colIron = totalIron - draftShip.ironium;
    const colBora = totalBora - draftShip.boranium;
    const colGerm = totalGerm - draftShip.germanium;
    const totalShipMin = draftShip.ironium + draftShip.boranium + draftShip.germanium;

    sShipPop.value = String(draftShip.colonists);
    sShipIron.value = String(draftShip.ironium);
    sShipBora.value = String(draftShip.boranium);
    sShipGerm.value = String(draftShip.germanium);

    sColPop.value = String(colPop);
    sColIron.value = String(colIron);
    sColBora.value = String(colBora);
    sColGerm.value = String(colGerm);

    document.getElementById("val-ship-pop")!.textContent = draftShip.colonists.toLocaleString();
    document.getElementById("val-ship-iron")!.textContent = `${draftShip.ironium} kT`;
    document.getElementById("val-ship-bora")!.textContent = `${draftShip.boranium} kT`;
    document.getElementById("val-ship-germ")!.textContent = `${draftShip.germanium} kT`;

    document.getElementById("val-col-pop")!.textContent = colPop.toLocaleString();
    document.getElementById("val-col-iron")!.textContent = `${colIron} kT`;
    document.getElementById("val-col-bora")!.textContent = `${colBora} kT`;
    document.getElementById("val-col-germ")!.textContent = `${colGerm} kT`;

    document.getElementById("modal-cap-pop")!.textContent =
      `${draftShip.colonists.toLocaleString()} / ${cap.maxColonists.toLocaleString()}`;
    document.getElementById("modal-cap-min")!.textContent =
      `${totalShipMin} / ${cap.maxMineralsKt} kT`;

    const popPct = cap.maxColonists > 0 ? Math.min(100, (draftShip.colonists / cap.maxColonists) * 100) : 0;
    const minPct = cap.maxMineralsKt > 0 ? Math.min(100, (totalShipMin / cap.maxMineralsKt) * 100) : 0;
    (document.getElementById("modal-bar-pop") as HTMLElement).style.width = `${popPct}%`;
    (document.getElementById("modal-bar-min") as HTMLElement).style.width = `${minPct}%`;
  }

  function setShipColonists(desired: number): void {
    draftShip.colonists = Math.max(0, Math.min(maxShipColonists, Math.round(desired)));
    syncSlidersUI();
  }

  function setShipMineral(key: "ironium" | "boranium" | "germanium", desired: number, totalPool: number): void {
    const otherMin =
      (key === "ironium" ? 0 : draftShip.ironium) +
      (key === "boranium" ? 0 : draftShip.boranium) +
      (key === "germanium" ? 0 : draftShip.germanium);
    const maxForThis = Math.max(0, Math.min(totalPool, cap.maxMineralsKt - otherMin));
    draftShip[key] = Math.max(0, Math.min(maxForThis, Math.round(desired)));
    syncSlidersUI();
  }

  // Left (Ship) slider listeners
  sShipPop.addEventListener("input", () => setShipColonists(Number(sShipPop.value)));
  sShipIron.addEventListener("input", () => setShipMineral("ironium", Number(sShipIron.value), totalIron));
  sShipBora.addEventListener("input", () => setShipMineral("boranium", Number(sShipBora.value), totalBora));
  sShipGerm.addEventListener("input", () => setShipMineral("germanium", Number(sShipGerm.value), totalGerm));

  // Right (Colony) slider listeners — moving colony supply up unloads from ship; moving it down loads onto ship
  sColPop.addEventListener("input", () => setShipColonists(totalColonists - Number(sColPop.value)));
  sColIron.addEventListener("input", () => setShipMineral("ironium", totalIron - Number(sColIron.value), totalIron));
  sColBora.addEventListener("input", () => setShipMineral("boranium", totalBora - Number(sColBora.value), totalBora));
  sColGerm.addEventListener("input", () => setShipMineral("germanium", totalGerm - Number(sColGerm.value), totalGerm));

  document.getElementById("btn-modal-fill-pop")!.addEventListener("click", () => {
    setShipColonists(maxShipColonists);
  });

  document.getElementById("btn-modal-unload-all")!.addEventListener("click", () => {
    draftShip.colonists = 0;
    draftShip.ironium = 0;
    draftShip.boranium = 0;
    draftShip.germanium = 0;
    syncSlidersUI();
  });

  document.getElementById("btn-modal-cancel")!.addEventListener("click", closeCargoModal);

  document.getElementById("btn-modal-ok")!.addEventListener("click", () => {
    deltaStore.applyExactCargoTransfer(fleet.id, planet, draftShip, deltaStore.getSimNowMs());
    closeCargoModal();
    renderUI();
  });

  syncSlidersUI();
  cargoModalBackdrop.classList.add("open");
}

function updateLiveInspectorTelemetry(simNowMs: number): void {
  if (!selectedStar || selectedPlanetIndex < 1) return;
  const planets = getPlanetsForStar(selectedStar);
  const activePlanet = planets[selectedPlanetIndex - 1];
  if (!activePlanet) return;

  const pos = getPlanetPositionMeters(selectedStar, activePlanet, simNowMs);
  const elXY = document.getElementById("live-planet-xy");
  if (elXY) {
    elXY.textContent = `${formatMetersBigInt(pos.xMeters)} , ${formatMetersBigInt(pos.yMeters)}`;
  }

  const state = deltaStore.evaluate(activePlanet, simNowMs);
  if (state.isModified) {
    const elIron = document.getElementById("live-iron");
    const elBora = document.getElementById("live-bora");
    const elGerm = document.getElementById("live-germ");
    const elPop = document.getElementById("live-pop");
    if (elIron) elIron.textContent = `${state.surfaceIroniumKt} kT (+${state.ironiumMiningRatePerMin}/m)`;
    if (elBora) elBora.textContent = `${state.surfaceBoraniumKt} kT (+${state.boraniumMiningRatePerMin}/m)`;
    if (elGerm) elGerm.textContent = `${state.surfaceGermaniumKt} kT (+${state.germaniumMiningRatePerMin}/m)`;
    if (elPop) elPop.textContent = `${state.population.toLocaleString()} (+${state.populationGrowthPerMin}/m)`;
  }
}

// FPS & periodic UI refresh tracking
let lastFrameTime = performance.now();
let smoothedFps = 60;
let lastUiRefreshTime = 0;

function renderFrame(): void {
  const frameNow = performance.now();
  const dt = Math.max(1, frameNow - lastFrameTime);
  lastFrameTime = frameNow;
  smoothedFps = smoothedFps * 0.9 + (1000 / dt) * 0.1;

  const simNowMs = deltaStore.getSimNowMs();
  const simEventsOccurred = deltaStore.updateSimulation(simNowMs);
  if (simEventsOccurred || frameNow - lastUiRefreshTime > 1000) {
    lastUiRefreshTime = frameNow;
    renderLeftSidebar(simNowMs);
    if (simEventsOccurred) renderInspector(simNowMs);
  }

  const width = window.innerWidth;
  const height = window.innerHeight;

  // Camera tracking (Planet Orbit or Fleet Flight)
  if (lockToFleet && selectedFleetId) {
    const fleet = deltaStore.getFleetById(selectedFleetId);
    if (fleet) {
      const pos = deltaStore.getFleetPositionMeters(fleet, simNowMs);
      camX = pos.xMeters;
      camY = pos.yMeters;
    }
  } else if (lockToPlanet && selectedStar && selectedPlanetIndex >= 1) {
    const planets = getPlanetsForStar(selectedStar);
    const p = planets[selectedPlanetIndex - 1];
    if (p) {
      const pos = getPlanetPositionMeters(selectedStar, p, simNowMs);
      camX = pos.xMeters;
      camY = pos.yMeters;
    }
  }

  updateLiveInspectorTelemetry(simNowMs);

  ctx.fillStyle = "#04060c";
  ctx.fillRect(0, 0, width, height);

  frameHitTargets = [];
  let drawnStarsCount = 0;
  let activeStride = 1;

  const allDeltas = deltaStore.getAllDeltas();
  const allFleets = deltaStore.getAllFleets();

  // =========================================================================
  // 1. DRAW SCANNER COVERAGE RINGS (Sector & Constellation Views)
  // =========================================================================
  if (metersPerPixel <= 3e15 && metersPerPixel >= 2e11) {
    ctx.save();
    ctx.strokeStyle = "rgba(77, 166, 255, 0.16)";
    ctx.fillStyle = "rgba(77, 166, 255, 0.025)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);

    // Colony space-traffic radar (detects ships in flight; does NOT scan remote planet surfaces)
    for (const { id, delta } of allDeltas) {
      if (delta.owner !== "Player") continue;
      const star = getStarById(id);
      if (!star) continue;
      const scanLy = delta.hasStarbase ? 1.8 : 1.0;
      const rPx = (scanLy * Number(METERS_PER_LIGHT_YEAR)) / metersPerPixel;
      const [sx, sy] = worldToScreen(star.xMeters, star.yMeters, width, height);
      if (sx + rPx < 0 || sx - rPx > width || sy + rPx < 0 || sy - rPx > height) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Fleet scanners (only active while fleet has onboard power!)
    for (const fleet of allFleets) {
      if (fleet.owner !== "Player") continue;
      const pwr = deltaStore.getFleetPowerState(fleet, simNowMs);
      if (!pwr.isPowered) continue;
      const pos = deltaStore.getFleetPositionMeters(fleet, simNowMs);
      const scanLy = deltaStore.getFleetScannerLy(fleet.ships);
      const rPx = (scanLy * Number(METERS_PER_LIGHT_YEAR)) / metersPerPixel;
      const [sx, sy] = worldToScreen(pos.xMeters, pos.yMeters, width, height);
      if (sx + rPx < 0 || sx - rPx > width || sy + rPx < 0 || sy - rPx > height) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // =========================================================================
  // 2. UNIFIED MULTI-TIER QUADTREE LOD (Stride = 1, 2, 4, 8 .. 1024 ly)
  // =========================================================================
  if (metersPerPixel >= 2e11) {
    if (metersPerPixel > 5e14) {
      const [coreX, coreY] = worldToScreen(0n, 0n, width, height);
      const coreRadiusPx = (12_000 * Number(METERS_PER_LIGHT_YEAR)) / metersPerPixel;
      if (coreRadiusPx > 2) {
        const grad = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreRadiusPx);
        grad.addColorStop(0, "rgba(255, 225, 170, 0.32)");
        grad.addColorStop(0.35, "rgba(120, 165, 255, 0.11)");
        grad.addColorStop(1, "rgba(10, 20, 40, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(coreX, coreY, coreRadiusPx, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const lyAcrossWidth = (width * metersPerPixel) / Number(CELL_SIZE_METERS);
    const rawStride = Math.max(1, lyAcrossWidth / 38);
    const stride = Math.min(1024, 1 << Math.max(0, Math.ceil(Math.log2(rawStride))));
    activeStride = stride;

    const halfSpanMetersX = BigInt(Math.ceil(width * 0.55 * metersPerPixel));
    const halfSpanMetersY = BigInt(Math.ceil(height * 0.55 * metersPerPixel));

    const maxGalCell = Math.ceil(GALAXY_RADIUS_LY * 1.15);
    const minCellX = Math.max(-maxGalCell, Number((camX - halfSpanMetersX) / CELL_SIZE_METERS) - stride);
    const maxCellX = Math.min(maxGalCell, Number((camX + halfSpanMetersX) / CELL_SIZE_METERS) + stride);
    const minCellY = Math.max(-maxGalCell, Number((camY - halfSpanMetersY) / CELL_SIZE_METERS) - stride);
    const maxCellY = Math.min(maxGalCell, Number((camY + halfSpanMetersY) / CELL_SIZE_METERS) + stride);

    const minBlockX = Math.floor(minCellX / stride);
    const maxBlockX = Math.floor(maxCellX / stride);
    const minBlockY = Math.floor(minCellY / stride);
    const maxBlockY = Math.floor(maxCellY / stride);

    const cellPx = Number(CELL_SIZE_METERS) / metersPerPixel;
    if (stride === 1 && cellPx >= 35 && cellPx <= 2500) {
      ctx.strokeStyle = "rgba(50, 75, 120, 0.18)";
      ctx.lineWidth = 1;
      for (let cx = minBlockX; cx <= maxBlockX; cx++) {
        const [sx] = worldToScreen(BigInt(cx) * CELL_SIZE_METERS, camY, width, height);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
      }
      for (let cy = minBlockY; cy <= maxBlockY; cy++) {
        const [, sy] = worldToScreen(camX, BigInt(cy) * CELL_SIZE_METERS, width, height);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
        ctx.stroke();
      }
    }

    for (let bx = minBlockX; bx <= maxBlockX; bx++) {
      for (let by = minBlockY; by <= maxBlockY; by++) {
        const stars = getSuperBlockStars(bx, by, stride);
        for (let i = 0; i < stars.length; i++) {
          const star = stars[i];
          const [sx, sy] = worldToScreen(star.xMeters, star.yMeters, width, height);
          if (sx < -24 || sx > width + 24 || sy < -24 || sy > height + 24) continue;

          drawnStarsCount++;
          const isSelected = selectedStar?.id === star.id;
          const isScanned = isStarRevealed(star.id);
          const rPx = isSelected
            ? 5
            : stride > 4
              ? 1.5
              : Math.max(1.8, Math.min(4.2, Math.log10(star.luminositySolar + 2) * 2.4));

          if (activeOverlay === "normal" || stride > 8) {
            ctx.fillStyle = star.color;
            if (rPx <= 2.3 && !isSelected) {
              ctx.fillRect(sx - rPx * 0.5, sy - rPx * 0.5, rPx, rPx);
            } else {
              ctx.beginPath();
              ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
              ctx.fill();
            }

            if (stride <= 2 && isScanned) {
              ctx.strokeStyle = "rgba(61, 220, 151, 0.45)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.arc(sx, sy, rPx + 3.5, 0, Math.PI * 2);
              ctx.stroke();
            }

            if (stride === 1 && (cellPx > 65 || isSelected)) {
              ctx.fillStyle = isSelected
                ? "#ffffff"
                : isScanned
                  ? "#b8f5d8"
                  : "rgba(180, 195, 220, 0.65)";
              ctx.font = "11px Inter, sans-serif";
              ctx.fillText(star.name, sx + rPx + 5, sy + 3);
            }
          } else {
            // Active Overlay Mode (Habitability, Mineral Concentration, or Surface Abundance)
            const ov = evaluateSystemOverlay(star, activeOverlay, simNowMs);

            if (!ov.isKnown) {
              // Unscanned system in overlay mode: muted gray dot
              ctx.fillStyle = "rgba(120, 135, 165, 0.45)";
              ctx.beginPath();
              ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
              ctx.fill();

              if (stride === 1 && (cellPx > 80 || isSelected)) {
                ctx.fillStyle = "rgba(140, 155, 185, 0.55)";
                ctx.font = "10px Inter, sans-serif";
                ctx.fillText(`${star.name} [?]`, sx + 6, sy + 3);
              }
            } else {
              // Scanned system: draw non-diminishing multi-planet value halo + ring
              const haloRadius = ov.normalized > 0 ? 4.5 + ov.normalized * 17 : 3.5;

              ctx.fillStyle = ov.fillColor;
              ctx.beginPath();
              ctx.arc(sx, sy, haloRadius, 0, Math.PI * 2);
              ctx.fill();

              ctx.strokeStyle = ov.ringColor;
              ctx.lineWidth = ov.normalized > 0.35 ? 2 : 1.2;
              ctx.beginPath();
              ctx.arc(sx, sy, haloRadius, 0, Math.PI * 2);
              ctx.stroke();

              // Center star core pip
              ctx.fillStyle = star.color;
              ctx.beginPath();
              ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
              ctx.fill();

              if (stride === 1 && (cellPx > 60 || isSelected)) {
                ctx.fillStyle = "#ffffff";
                ctx.font = "11px Inter, sans-serif";
                ctx.fillText(star.name, sx + haloRadius + 5, sy - 2);
                ctx.fillStyle = ov.ringColor;
                ctx.font = "10px monospace";
                ctx.fillText(ov.label, sx + haloRadius + 5, sy + 10);
              }
            }
          }

          frameHitTargets.push({
            screenX: sx,
            screenY: sy,
            hitRadius: stride > 4 ? 8 : 14,
            star,
            planetIndex: 0,
          });
        }
      }
    }

    // Highlight colonized systems at Sector/Galaxy zoom (only if Player-owned or scanned!)
    for (const { id, delta } of allDeltas) {
      const star = getStarById(id);
      if (!star) continue;
      if (delta.owner !== "Player" && !isStarRevealed(star.id)) continue;
      const [sx, sy] = worldToScreen(star.xMeters, star.yMeters, width, height);
      if (sx < -20 || sx > width + 20 || sy < -20 || sy > height + 20) continue;
      ctx.strokeStyle = delta.owner === "Player" ? "#3ddc97" : "#ff5d5d";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 7, sy - 7, 14, 14);
    }

    // Always highlight currently selected star
    if (selectedStar) {
      const [sx, sy] = worldToScreen(selectedStar.xMeters, selectedStar.yMeters, width, height);
      if (sx >= -20 && sx <= width + 20 && sy >= -20 && sy <= height + 20) {
        ctx.strokeStyle = "#4da6ff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // =========================================================================
  // 3. SOLAR SYSTEM & 1-METER TACTICAL VIEW (metersPerPixel < 5e12)
  // =========================================================================
  if (metersPerPixel < 5e12 && selectedStar) {
    if (metersPerPixel <= 500) {
      let gridStepMeters = 1n;
      let gridLabel = "1m";
      if (metersPerPixel > 50) {
        gridStepMeters = 100n;
        gridLabel = "100m";
      } else if (metersPerPixel > 5) {
        gridStepMeters = 10n;
        gridLabel = "10m";
      }

      const halfW = BigInt(Math.ceil(width * 0.6 * metersPerPixel));
      const halfH = BigInt(Math.ceil(height * 0.6 * metersPerPixel));
      const startX = ((camX - halfW) / gridStepMeters) * gridStepMeters;
      const endX = camX + halfW;
      const startY = ((camY - halfH) / gridStepMeters) * gridStepMeters;
      const endY = camY + halfH;

      ctx.strokeStyle = "rgba(61, 220, 151, 0.14)";
      ctx.lineWidth = 1;
      for (let gx = startX; gx <= endX; gx += gridStepMeters) {
        const [sx] = worldToScreen(gx, camY, width, height);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
      }
      for (let gy = startY; gy <= endY; gy += gridStepMeters) {
        const [, sy] = worldToScreen(camX, gy, width, height);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(61, 220, 151, 0.7)";
      ctx.font = "11px monospace";
      ctx.fillText(`TACTICAL GRID RESOLUTION: ${gridLabel} per cell`, 305, height - 48);
    }

    const star = selectedStar;
    const isScanned = isStarRevealed(star.id);
    const [starSx, starSy] = worldToScreen(star.xMeters, star.yMeters, width, height);
    const starRadiusPx = Math.max(5, star.radiusMeters / metersPerPixel);

    if (
      starSx + starRadiusPx > -200 &&
      starSx - starRadiusPx < width + 200 &&
      starSy + starRadiusPx > -200 &&
      starSy - starRadiusPx < height + 200
    ) {
      ctx.fillStyle = star.color;
      ctx.beginPath();
      ctx.arc(starSx, starSy, starRadiusPx, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.font = "12px Inter, sans-serif";
      ctx.fillText(`${star.name} (${star.spectralClass})`, starSx + starRadiusPx + 6, starSy + 4);

      frameHitTargets.push({
        screenX: starSx,
        screenY: starSy,
        hitRadius: Math.max(12, starRadiusPx),
        star,
        planetIndex: 0,
      });
    }

    const planets = getPlanetsForStar(star);
    for (const planet of planets) {
      const orbitRadiusPx = Number(planet.orbitRadiusMeters) / metersPerPixel;
      const isSelectedPlanet = selectedPlanetIndex === planet.planetIndex;
      const evalState = deltaStore.evaluate(planet, simNowMs);

      if (orbitRadiusPx > 3 && orbitRadiusPx < 50_000) {
        ctx.strokeStyle = isSelectedPlanet
          ? "rgba(77, 166, 255, 0.45)"
          : "rgba(140, 170, 220, 0.16)";
        ctx.lineWidth = isSelectedPlanet ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(starSx, starSy, orbitRadiusPx, 0, Math.PI * 2);
        ctx.stroke();
      }

      const pos = getPlanetPositionMeters(star, planet, simNowMs);
      const [px, py] = worldToScreen(pos.xMeters, pos.yMeters, width, height);

      if (px < -100 || px > width + 100 || py < -100 || py > height + 100) continue;

      const physicalRadiusPx = planet.radiusMeters / metersPerPixel;
      const drawRadiusPx = Math.max(4, Math.min(2000, physicalRadiusPx));

      const showHab = isScanned || evalState.isModified;
      ctx.fillStyle = !showHab
        ? "#6c7a96"
        : evalState.effectiveHabitabilityPct >= 50
          ? "#3ddc97"
          : evalState.effectiveHabitabilityPct > 0
            ? "#ffbe55"
            : "#d96b6b";
      ctx.beginPath();
      ctx.arc(px, py, drawRadiusPx, 0, Math.PI * 2);
      ctx.fill();

      if (evalState.isModified || isSelectedPlanet) {
        ctx.strokeStyle = evalState.isModified
          ? evalState.owner === "Player"
            ? "#3ddc97"
            : "#ff5d5d"
          : "#4da6ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, drawRadiusPx + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (metersPerPixel <= 50) {
        const stationOffsetMeters = 25n;
        const [stX, stY] = worldToScreen(
          pos.xMeters + stationOffsetMeters,
          pos.yMeters - stationOffsetMeters,
          width,
          height,
        );
        const stationSizePx = Math.max(4, 6 / metersPerPixel);
        ctx.strokeStyle = "#4da6ff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
          stX - stationSizePx * 0.5,
          stY - stationSizePx * 0.5,
          stationSizePx,
          stationSizePx,
        );
        ctx.fillStyle = "#92b5ff";
        ctx.font = "11px monospace";
        ctx.fillText("Orbital Beacon (+25m, -25m)", stX + stationSizePx * 0.5 + 6, stY + 4);
      }

      let overlayPlanetSuffix = "";
      if (showHab && activeOverlay !== "normal") {
        if (activeOverlay === "habitability") {
          overlayPlanetSuffix = ` (${evalState.effectiveHabitabilityPct}% Hab)`;
        } else if (activeOverlay === "conc_iron") {
          overlayPlanetSuffix = ` (Fe: ${planet.ironiumConc}%)`;
        } else if (activeOverlay === "conc_bora") {
          overlayPlanetSuffix = ` (Bo: ${planet.boraniumConc}%)`;
        } else if (activeOverlay === "conc_germ") {
          overlayPlanetSuffix = ` (Ge: ${planet.germaniumConc}%)`;
        } else if (activeOverlay === "abundance") {
          const totKt = Math.round(
            evalState.surfaceIroniumKt + evalState.surfaceBoraniumKt + evalState.surfaceGermaniumKt,
          );
          overlayPlanetSuffix = ` (${totKt.toLocaleString()} kT)`;
        }
      }

      ctx.fillStyle = isSelectedPlanet ? "#ffffff" : "rgba(226, 232, 240, 0.85)";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(
        `${evalState.displayName}${evalState.isModified ? ` [${evalState.owner?.toUpperCase()}]` : ""}${overlayPlanetSuffix}`,
        px + Math.min(30, drawRadiusPx) + 7,
        py + 4,
      );

      frameHitTargets.push({
        screenX: px,
        screenY: py,
        hitRadius: Math.max(12, Math.min(40, drawRadiusPx)),
        star,
        planetIndex: planet.planetIndex,
      });
    }
  }

  // =========================================================================
  // 4. DRAW PROPAGATING TELEMETRY SIGNALS & FLEET VECTORS
  // =========================================================================
  const pendingSignals = deltaStore.getAllPendingSignals();
  for (const sig of pendingSignals) {
    const [srcX, srcY] = worldToScreen(sig.sourceX, sig.sourceY, width, height);
    const [recX, recY] = worldToScreen(sig.receiverX, sig.receiverY, width, height);
    const dur = Math.max(1, sig.arrivalSimMs - sig.emittedSimMs);
    const prog = Math.max(0, Math.min(1, (simNowMs - sig.emittedSimMs) / dur));

    const curX = srcX + (recX - srcX) * prog;
    const curY = srcY + (recY - srcY) * prog;

    ctx.save();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(srcX, srcY);
    ctx.lineTo(recX, recY);
    ctx.stroke();

    // Expanding telemetry wavefront ring around the moving packet
    ctx.setLineDash([]);
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(curX, curY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(curX, curY, 8, 0, Math.PI * 2);
    ctx.stroke();

    if (metersPerPixel <= 8e14) {
      const remSec = Math.max(0, Math.ceil((sig.arrivalSimMs - simNowMs) / 1000));
      ctx.fillStyle = "#7dd3fc";
      ctx.font = "10px monospace";
      ctx.fillText(`TELEMETRY: ${sig.starName} (${remSec}s)`, curX + 11, curY + 3);
    }
    ctx.restore();
  }

  for (const fleet of allFleets) {
    if (fleet.owner !== "Player" && fleet.orbitTargetId !== null) {
      const fStar = getStarById(fleet.orbitTargetId);
      if (fStar && !isStarRevealed(fStar.id)) continue;
    }
    const pos = deltaStore.getFleetPositionMeters(fleet, simNowMs);
    const [fx, fy] = worldToScreen(pos.xMeters, pos.yMeters, width, height);

    // Draw active flight path line + any queued gravity-assist legs if in transit
    if (!pos.inOrbit && !pos.isCoastingPast) {
      const [dx, dy] = worldToScreen(fleet.destX, fleet.destY, width, height);
      ctx.save();
      ctx.strokeStyle =
        fleet.owner === "Player"
          ? fleet.burnMode === "flyby"
            ? "rgba(255, 190, 85, 0.75)"
            : "rgba(77, 166, 255, 0.65)"
          : "rgba(255, 93, 93, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(dx, dy);

      if (fleet.queuedWaypoints && fleet.queuedWaypoints.length > 0) {
        let prevWx = dx;
        let prevWy = dy;
        for (const qId of fleet.queuedWaypoints) {
          const qStar = getStarById(qId);
          if (!qStar) continue;
          const [qx, qy] = worldToScreen(qStar.xMeters, qStar.yMeters, width, height);
          ctx.moveTo(prevWx, prevWy);
          ctx.lineTo(qx, qy);
          prevWx = qx;
          prevWy = qy;
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // Draw interactive Route Planner Preview for the selected fleet
    if (fleet.id === selectedFleetId && fleet.plannedRoute && fleet.plannedRoute.length > 0) {
      const plan = deltaStore.evaluateRoutePlan(fleet, fleet.plannedRoute, simNowMs);
      ctx.save();
      ctx.strokeStyle = plan.canAffordFuel
        ? "rgba(61, 220, 151, 0.85)"
        : "rgba(255, 93, 93, 0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);

      for (const leg of plan.legs) {
        const [lx0, ly0] = worldToScreen(leg.fromX, leg.fromY, width, height);
        const [lx1, ly1] = worldToScreen(leg.toX, leg.toY, width, height);
        ctx.beginPath();
        ctx.moveTo(lx0, ly0);
        ctx.lineTo(lx1, ly1);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = plan.canAffordFuel ? "#3ddc97" : "#ff5d5d";
        ctx.beginPath();
        ctx.arc(lx1, ly1, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#04060c";
        ctx.font = "bold 9px monospace";
        ctx.fillText(String(leg.legIndex), lx1 - 3, ly1 + 3);

        ctx.fillStyle = plan.canAffordFuel ? "#b8f5d8" : "#ff99a8";
        ctx.font = "10px monospace";
        const turnTag = leg.legIndex > 1 ? `${leg.deflectionDeg}° turn, ` : "";
        ctx.fillText(
          `#${leg.legIndex} (${turnTag}-${leg.legTotalFuelPct}% fuel)`,
          lx1 + 10,
          ly1 - 6,
        );
        ctx.setLineDash([6, 4]);
      }
      ctx.restore();
    }

    // Offset slightly if in orbit so the fleet icon sits cleanly beside the star/planet
    const drawX = pos.inOrbit ? fx + 10 : fx;
    const drawY = pos.inOrbit ? fy - 10 : fy;

    if (drawX < -30 || drawX > width + 30 || drawY < -30 || drawY > height + 30) continue;

    const isSelFleet = fleet.id === selectedFleetId;
    const pwr = deltaStore.getFleetPowerState(fleet, simNowMs);
    ctx.fillStyle = !pwr.isPowered
      ? "#5c687d"
      : fleet.owner === "Player"
        ? "#4da6ff"
        : "#ff5d5d";
    ctx.beginPath();
    ctx.moveTo(drawX, drawY - 6);
    ctx.lineTo(drawX + 5, drawY + 5);
    ctx.lineTo(drawX, drawY + 2);
    ctx.lineTo(drawX - 5, drawY + 5);
    ctx.closePath();
    ctx.fill();

    if (isSelFleet) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(drawX, drawY, 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (metersPerPixel <= 5e14 || isSelFleet) {
      ctx.fillStyle = !pwr.isPowered
        ? "#7b89a3"
        : isSelFleet
          ? "#ffffff"
          : fleet.owner === "Player"
            ? "#92b5ff"
            : "#ff99a8";
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText(
        `${fleet.name}${!pwr.isPowered ? " [0% PWR]" : ""}`,
        drawX + 8,
        drawY + 3,
      );
    }
  }

  // Update top HUD telemetry
  const camCellX = Number(camX / CELL_SIZE_METERS);
  const camCellY = Number(camY / CELL_SIZE_METERS);
  const gameYear = deltaStore.getGameYear(simNowMs).toFixed(2);
  hudCoords.textContent = `Year ${gameYear} | X: ${formatMetersBigInt(camX)} | Y: ${formatMetersBigInt(camY)}`;
  hudCell.textContent = `Cell: (${camCellX}, ${camCellY}) | Scale: ${formatScale(metersPerPixel)} | LOD: ${activeStride}x${activeStride} ly | Stars: ${drawnStarsCount} | ${Math.round(smoothedFps)} FPS`;

  requestAnimationFrame(renderFrame);
}

initSandbox();
renderUI();
requestAnimationFrame(renderFrame);
