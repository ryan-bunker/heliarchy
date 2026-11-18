# Hard Sci-Fi Physics & Movement Mechanics

**Core Architecture:** Newtonian Straight-Line (Brachistochrone) Transit  
**Design Goal:** Capture the tactical depth, logistical tension, and *Stars!*-style mind games of hard sci-fi spaceflight without incurring the server overhead or UI micromanagement tax of full $n$-body/Keplerian orbital mechanics.

---

## 1. Dynamic Planetary Orbits (Moving Targets, Straight Vectors)
* **Concept:** Planets, moons, and asteroid belts follow simple, deterministic circular or elliptical orbits around their parent stars, while ships continue to travel in straight-line Newtonian vectors between predicted intercept points.
* **Gameplay Impact:** 
  * Distances between colonies and mining outposts constantly shift over time.
  * A freighter supply route that takes 4 hours at closest approach might take 14 hours when the planets are in opposition.
  * Forces players to actively manage fuel reserves, adjust automated freighter schedules, and plan offensive campaigns around favorable planetary alignments.
* **Technical Note:** Planetary positions can be calculated analytically at any timestamp $t$ without needing continuous physics ticks, keeping server load near zero while still requiring intercept-lead calculations for fleet routing.

## 2. Vector Commitment & "Turn-and-Burn" Tactics
* **Concept:** Lean heavily into inertia, mass ratios, and thrust-to-weight limits. Ships accelerate via fuel-consuming burns, coast at constant velocity ($P(t) = P_0 + V t$), and must flip to execute a deceleration burn before arriving at their destination.
* **Gameplay Impact:**
  * **High-Inertia Capital Ships:** Heavy dreadnoughts or bulk freighters build massive momentum; if ambushed mid-coast or if their target moves, they cannot turn on a dime and must expend enormous fuel and time just to kill their existing velocity vector.
  * **Agile Recon & Interceptors:** Light hulls with high thrust-to-weight ratios become essential for rapid vector changes, flanking, and intercepting fast-moving targets.
  * **Fuel vs. Speed Trade-offs:** Players must choose between low-burn, long-coast "economy" transits (preserving $\Delta v$ for combat maneuvers) or high-burn "emergency" transits that arrive quickly but leave the fleet fuel-starved on arrival.

## 3. Gravity Wells as Spatial Terrain
* **Concept:** Rather than simulating continuous gravitational pull on every ship in flight, treat massive bodies (stars, gas giants, black holes) as environmental zones with distinct physical rules.
* **Gameplay Impact:**
  * **Gravity Well Drive Limits:** High-efficiency interplanetary/interstellar drives cannot safely engage deep inside a strong gravity well. Fleets must cruise out to a system's "burn limit" before accelerating to full speed—recreating the classic *Stars!* warp-limit chokepoints and ambush zones using physical rules.
  * **Simplified Slingshot / Gravity Assists:** Routing a trajectory tangentially close to a gas giant or star grants a flat $\Delta v$ velocity bonus along the exit vector without burning fuel, rewarding players who manually plot clever routes around stellar terrain.
  * **Sensor & Thermal Masking:** Skimming close to a star's corona or hiding behind a gas giant masks a fleet's thermal signature from passive scanners.

## 4. Light-Speed Sensor Delay & Thermal Signatures
* **Concept:** Enforce finite signal propagation speeds across your to-scale galaxy, paired with a thermodynamics-based detection model (active drive plumes vs. cold coasting).
* **Gameplay Impact:**
  * **Information Lag:** Detecting a fleet at a distance means seeing where it *was* minutes or hours ago (scaled to your game's time ratio), requiring players to extrapolate enemy vectors rather than reacting to omniscient real-time data.
  * **Drive Plume Visibility:** A fleet executing a massive deceleration burn lights up like a flare across the sector, broadcasting its mass, thrust, and trajectory to passive sensors light-hours away.
  * **Cold Coasting Stealth:** A fleet that finishes its acceleration burn early and coasts "cold" with reactors throttled down becomes nearly invisible against background radiation—recreating *Stars!*-style cloaking, scanner evasion, and ambush mechanics through pure physics.