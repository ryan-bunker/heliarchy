# Heliarchy (Prototype)

A browser-based TypeScript + `BigInt` prototype for **Heliarchy**, a real-time 2D massive multiplayer 4X space strategy game inspired by *Stars!* (1995).

This prototype validates the core technical and gameplay foundations before porting the simulation core to Rust/WebAssembly and adding a multiplayer backend (see [ROADMAP.md](./ROADMAP.md)).

---

## Key Features Implemented

### 1. Stateless Procedural Galaxy & 1-Meter Precision
- **100,000 Light-Year Spiral Galaxy (`src/galaxy.ts`):** Uses deterministic 64-bit `SplitMix64` spatial hashing over a $1\text{ ly} \times 1\text{ ly}$ Cartesian grid with a 4-arm barred logarithmic spiral density function—requiring **0 bytes** of upfront database storage.
- **1-Meter Coordinate Granularity:** All global positions use 128-bit integer (`BigInt`) meter coordinates and camera-relative subtraction before screen projection, allowing smooth zooming across **18 orders of magnitude**—from the `100,000 ly` galactic overview down to a `1 meter/pixel` tactical orbit grid with zero floating-point jitter.
- **Bit-Packed 64-Bit Object IDs:** Every star and planet has a unique `u64` ID encoding `(cellX, cellY, starIndex, planetIndex, moonIndex)` for $O(1)$ direct lookup.
- **Power-of-Two Quadtree LOD:** Dynamically strides super-blocks (`1x1` up to `1024x1024` ly) to keep rendering at 60+ FPS across all zoom levels.

### 2. Lazy-Evaluated Real-Time *Stars!* Economy (`src/deltas.ts`)
- **Delta Overlay Persistence:** Untouched planets store nothing; colonized/modified planets store compact checkpoints in `localStorage` keyed by their 64-bit ID.
- **Continuous Simulation (`1x = 30 min / Game Year`):**
  - Classic *Stars!* Humanoid (`1..99` click) habitability distribution (~35% green planets).
  - **Mines** (`5R`, `0` minerals), **Factories** (`10R`, `4 kT` Germanium), and **Starbases** (`100R` + minerals).
  - **Worker Operation Caps** (`1` Mine & `1` Factory operable per `1,000` colonists) and logistic population crowding above 25% carrying capacity.
- **Interactive Cargo Transfer Modal:** Linked two-column slider dialog for transferring colonists and Ironium/Boranium/Germanium between orbiting fleets and colonies.

### 3. Newtonian Propulsion, Gravity-Assist Route Planner & Telemetry Lag
- **Accelerate, Coast for Free, Brake:** Ships only spend reaction mass (`Fuel %`) to accelerate, execute mid-course gravity-assist turns, or brake into orbit—coasting through vacuum uses `0` fuel per light-year.
- **Burn Intensity Slider (`Burn 1–10`):** Trade cruise velocity for fuel efficiency (from slow long-range drift tours to all-out `Burn 10` sprints).
- **Gravity-Assist Route Planner:** `Shift + Right-Click` multiple stars to chain multi-system probe tours with live deflection-angle TCM fuel previews.
- **Finite-Speed Telemetry & Probe Power Drain:** Distant surveys transmit data back to your nearest colony at finite signal speed, while probes far beyond your frontier (`> 3.5 ly`) eventually exhaust onboard power (`0% Pwr` derelict).

### 4. Map Overlays & Debug Tools
- **Non-Diminishing Multi-Planet Map Overlays:** Toggle between `Normal`, `Habitability`, `Ironium %`, `Boranium %`, `Germanium %`, and `Mineral Abundance (kT)`.
- **Debug Reveal Toggle:** Bypass fog-of-war to inspect all procedural systems and overlays immediately.

---

## Running Locally

This project uses **Nix Flakes** (`nodejs_22` + `pnpm`) and **Vite**.

```bash
# Enter the dev environment and install dependencies
nix develop --command pnpm install

# Start the Vite dev server
nix develop --command pnpm run dev
```

To verify the TypeScript + production build:

```bash
nix develop --command pnpm run build
```

---

## Controls

- **Left-Click:** Select Star, Planet, or Fleet
- **Double-Click Star:** Toggle between Solar System View (`8 AU`) and Sector View (`15 ly`)
- **Right-Click Star/Planet:** Launch selected fleet to target
- **Shift + Right-Click:** Add waypoint to Gravity-Assist Route Planner
- **Drag:** Pan camera
- **Scroll Wheel:** Fine zoom (`Shift + Scroll` for fast macro zoom)
