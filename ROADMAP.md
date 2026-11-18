# Singularity — Architecture & Development Roadmap

A real-time, massive multiplayer 2D space strategy game inspired by *Stars!* (1995), set in a realistically scaled procedural galaxy (~200+ billion stars across 100,000 light-years) with **1-meter coordinate granularity** and **zero upfront database storage**.

---

## 1. Core Architectural Pillars

### 1.1 Coordinate System & 1-Meter Precision
- **World Space:** Strictly 2D Cartesian $(X, Y)$ measured in **exact integer meters** using 128-bit integers (`BigInt` in TypeScript, `i128` in Rust).
- **Scale Constants:**
  - $1 \text{ Astronomical Unit (AU)} = 149,597,870,700 \text{ m}$
  - $1 \text{ Light-Year (ly)} = 9,460,730,472,580,800 \text{ m}$
  - $\text{Galaxy Diameter} = 100,000 \text{ ly} \approx 9.46 \times 10^{20} \text{ m}$
- **Camera-Relative Rendering:** Screen projection always subtracts `cameraX / cameraY` from `objectX / objectY` in integer meter space *before* converting to floating-point pixels. This prevents floating-point jitter across 18 orders of magnitude of zoom.
- **Local Polar Coordinates:** Polar coordinates $(r, \theta)$ are used strictly locally inside:
  1. The barred 4-arm logarithmic spiral stellar density function $\lambda(cx, cy)$.
  2. Keplerian planetary orbit calculations around a parent star.

### 1.2 Stateless Procedural Generation & Bit-Packed 64-Bit IDs
- **Spatial Grid:** The galaxy is partitioned into $1\text{ ly} \times 1\text{ ly}$ cells.
- **PRNG:** Deterministic 64-bit `SplitMix64` seeded by hashing `(GALAXY_SEED, cellX, cellY)`.
- **Location-Encoded 64-Bit Object ID (`u64`):**
  - `Bits 63..46 (18 bits)`: `Cell_X` ($-131,072 \dots +131,071\text{ ly}$)
  - `Bits 45..28 (18 bits)`: `Cell_Y` ($-131,072 \dots +131,071\text{ ly}$)
  - `Bits 27..12 (16 bits)`: `Star_Index` within cell ($0 \dots 65,535$)
  - `Bits 11..4  (8 bits)`: `Planet_Index` ($0 = \text{Star}, 1 \dots 255 = \text{Planet}$)
  - `Bits 3..0   (4 bits)`: `Moon/Orbital_Index` ($0 = \text{Planet}, 1 \dots 15 = \text{Sub-body}$)
- Any client or server can unpack an ID in $O(1)$ time and generate the exact star/planet without querying a database.

### 1.3 Delta Overlay & Lazy Evaluation (No Global Tick Loop)
- **Zero-Storage Default:** Untouched stars and planets consume `0 bytes` in the database.
- **Delta Records:** Only colonized, scanned, or modified objects store a delta row keyed by their 64-bit ID.
- **Lazy Evaluation:**
  - Planets store a checkpoint (`lastCheckpointMs`, `populationAtCheckpoint`, `surfaceMineralsAtCheckpoint`, `mines`, `factories`, `buildQueue`). Current resources, population, and completed build queue items at timestamp $t$ are pure mathematical functions of $(t - \text{lastCheckpointMs})$.
  - Fleets store `(originX, originY, destX, destY, targetId, departureTimeMs, arrivalTimeMs, ships, cargo)`. Position at time $t$ is interpolated on the fly.
  - Database writes only occur when an **event** changes a rate of change (player issues an order, changes a build queue, or a fleet arrives at its waypoint).

### 1.4 Multi-Scale Quadtree LOD Rendering
- Viewport dynamically selects a power-of-two block stride (`1x1`, `2x2`, `4x4`, ..., `1024x1024` ly) to cap evaluated blocks at $\le 900$ per frame at every zoom level.
- Super-blocks promote the highest-luminosity real stars from within their bounds so every visible star at any zoom level is a real clickable `StarData` entity.

---

## 2. Development Milestones

### Milestone 0: Technical Proof of Concept (Completed)
- [x] Deterministic 64-bit `SplitMix64` PRNG and 64-bit ID packer/unpacker.
- [x] 100,000 ly spiral galaxy generation with *Stars!* habitability & mineral concentrations.
- [x] 18-order-of-magnitude zoom (`100,000 ly` down to `1 meter/pixel` tactical grid).
- [x] Power-of-two Quadtree LOD striding for 60+ FPS scrolling at all zoom levels.
- [x] Basic `localStorage` Delta Overlay & lazy-evaluated mining.

### Milestone 1: Single-Player 4X Gameplay Loop (Phase A — Completed)
Goal: Prove the core *Stars!* Explore / Expand / Exploit / Exterminate loop in real time with adjustable game speed.
- [x] **Simulation Clock & Speed Multiplier (`1x`, `10x`, `60x`, `300x`):** Allow testing both real-time MMO pacing and single-evening "blitz" pacing.
- [x] **Homeworld Initialization (Outer Spur Nursery):** Start the player in a lower-density Outer Rim / Orion Spur sector with a colonized Homeworld (100% habitability, initial population, mines, factories, starbase, starting Scout & Colony Ship).
- [x] **Planetary Production & Build Queues:**
  - Industrial resource calculation (`Resources/min` from population + factories).
  - Build queue for **Mine**, **Factory**, **Starbase**, **Scout**, **Colony Ship**, **Freighter**, and **Destroyer**, consuming Resources + Ironium/Boranium/Germanium.
- [x] **Newtonian $\Delta v$ Propulsion, Coasting & Waypoint Intercepts:**
  - Ships only expend reaction fuel to **accelerate** and **brake into orbit**; **coasting through vacuum uses zero fuel** regardless of distance.
  - **Orbit Transfer vs. Ballistic Flyby:** Players can toggle between `Orbit Transfer` (50% accel burn + 50% braking burn at destination) or `Ballistic Flyby` (100% fuel dumped into departure acceleration for **2x cruise velocity**, streaking past the target system without stopping and coasting out into deep space forever).
  - **Mass-Dependent Cruise Speed ($F = ma$):** Heavy Colony Ships and cargo-laden Freighters achieve lower cruise velocity from a burn than lightweight Scout Probes.
- [x] **Scanners, Finite-Speed Telemetry Propagation & Map Overlays:**
  - Stars are visible everywhere, but planet habitability/minerals are hidden (`Unscanned`) until a player's fleet or colony scanner sweeps the system.
  - **Finite Signal Speed ($C_{\text{signal}}$):** When a probe scans a distant system, a **Telemetry Signal Packet** travels from the probe back to the player's **nearest Colony / Comms Receiver** at finite signal speed (`6.0 ly/min`). Forward colonies act as relays that shorten information lag.
  - **Non-Diminishing Multi-Planet Map Overlays:** Switches for Habitability, Ironium/Boranium/Germanium Concentration, and Surface Mineral Abundance.
- [x] **Colonization, Fine-Grained Cargo Sliders & Basic Combat:**
  - Colony Ships can colonize uninhabited planets in orbit (consuming the Colony Ship and unloading colonists/minerals).
  - Interactive two-column slider dialog for transferring colonists and minerals between ships and colonies.
  - Destroyers automatically engage hostile fleets or bombard/capture enemy colonies upon arrival.

### Milestone 2: Multiplayer Server & Playtest with Friends (Phase B)
Goal: Allow 2–8 friends to connect via browser to a shared persistent galaxy sector.
- [ ] **WebSocket + SQLite/Postgres Backend:** Authoritative server storing `planet_deltas`, `fleets`, and `player_empires`.
- [ ] **Nursery Cluster Spawning:** Place newly registered players onto balanced homeworlds within a 20–30 light-year starting cluster so early-game interaction is guaranteed.
- [ ] **Server-Enforced Fog of War:** Only send enemy fleet vectors and detailed planet deltas to clients that have active scanner coverage in that region.
- [ ] **Cargo Routing & Mineral Packets:** Automated freighter routes and mass-driver mineral packets.

### Milestone 3: Deeper *Stars!* Mechanics (Phase C)
- [ ] **Custom Ship Designer:** Hulls, engines (fuel consumption vs. warp speed), scanners, shields, beam/torpedo weapons, and colonization/mining modules.
- [ ] **Racial Traits (PRT / LRT):** Customizable habitability immune ranges, growth rates, and economy bonuses.
- [ ] **Technology Research:** 6 research fields (Energy, Weapons, Propulsion, Construction, Electronics, Biotechnology).
- [ ] **Minefields & Wormholes:** Deep-space area denial and long-range galactic shortcuts.

### Milestone 4: Scale & Polish (Phase D)
- [ ] **Shared Rust/Wasm Core:** Port `galaxy.ts` and `deltas.ts` to a shared Rust crate compiled to WebAssembly for the browser and native binary for the backend server.
- [ ] **WebGL2 / WebGPU Instanced Viewport:** Upgrade from Canvas2D to instanced GPU shaders for 100k+ simultaneous objects, smooth LOD crossfades, and tactical battle visualization.
