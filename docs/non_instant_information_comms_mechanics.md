# Non-Instant Information & Comms Mechanics

**Core Architecture:** Tiered Latency & Infrastructure-Driven Intelligence

**Design Goal:** Make finite signal propagation speeds feel like a rewarding tactical layer—enabling stealth, guerrilla warfare, and electronic warfare—without bogging down basic fleet responsiveness or requiring players to do light-cone math.

---

## 1. The "Ansible vs. Radio" Split (Orders vs. Intelligence)

* **Concept:** Decouple **command latency** (sending orders to friendly ships) from **telemetry latency** (receiving sensor data across interstellar distances).
* **Gameplay Impact:**
  * **Instant Local/Networked Control:** Fleets operating within range of a friendly colony or active relay buoy respond to player commands in real time, keeping the UI snappy and responsive.
  * **Delayed Deep-Space Intel:** Sensor data from un-networked sectors travels back to the player's empire at a finite comms speed (e.g., 1 light-year per hour). Viewing an un-networked border system shows a historical snapshot rather than live reality.
  * **Blackout Zones & Standing Orders:** When an expeditionary fleet pushes beyond friendly relay coverage into enemy territory, command signals *do* suffer latency. Players must issue standing behavioral doctrines ("Engage targets of opportunity, retreat if hull drops below 40%"), turning deep-space offensives into genuine strategic commitments.

---

## 2. Comms Relays as Strategic Terrain

* **Concept:** Treat high-speed communication as physical infrastructure that players must build, link, defend, and sabotage, rather than a passive universal constant.
* **Gameplay Impact:**
  * **Relay Chains:** Unconnected planets communicate via slow baseline radio waves, but players can deploy chains of cheap **Relay Satellites** between systems. Along an active relay link, sensor telemetry and command signals travel $10\times$–$50\times$ faster.
  * **"Cutting the Telegraph Wires":** Creates high-value guerrilla targets. Before launching a major invasion, a stealth squadron can slip behind enemy lines and destroy two key relay buoys—blinding the defender's core worlds to the attack until a physical ship escapes the system or slow baseline signals arrive hours later.

---

## 3. Courier Ships & "Data Packets"

* **Concept:** Borrow directly from *Stars!*'s physical mineral packets, applying the same logistical tension to high-density intelligence and reconnaissance logs.
* **Gameplay Impact:**
  * **Radio Silence vs. Active Broadcast:** Broadcasting a high-power sensor report across light-years leaks the transmitter's exact coordinates to every enemy passive scanner in the sector. Recon fleets can stay dark under **Radio Silence**, storing telemetry locally instead.
  * **Physical Courier Drones:** To report findings without breaking stealth, scouts launch small, fast, low-signature **Courier Drones** back toward friendly relay networks to physically hand off the data.
  * **Intel Interception:** Because courier drones are physical entities on the map, defenders can hunt them down—destroying or capturing a courier before it reaches a relay denies the enemy all intelligence gathered by that scout.

---

## 4. Visualizing Uncertainty Without Math Homework

* **Concept:** Prevent player confusion around delayed information by translating signal lag into intuitive, diegetic UI elements.
* **Gameplay Impact:**
  * **Time-Stamped "Ghosts":** Render delayed enemy contacts as translucent holograms displaying an age badge (e.g., `-4h 12m`) alongside an expanding **probability ring** representing the maximum distance that fleet could have traveled since the signal was emitted.
  * **Predictive Intercept Cones:** When ordering a fleet to intercept a delayed contact, the UI projects a shaded cone extrapolating the target's last known velocity vector, allowing players to click inside the cone to plot an ambush without manual calculations.
  * **Signal Horizon Overlay:** A toggleable map ring around the player's relay network clearly delineates the boundary between **Live Telemetry** (inside the network) and **Historical Echoes** (outside the network).

---

## Technical Implementation Shortcut

* **Periodic Snapshot Log:** Avoid simulating continuous expanding light spheres for every object in the galaxy. Instead, record a lightweight **state snapshot per system** at fixed intervals (e.g., every 15 minutes of game time).
* **Lookup & Interpolation:** When a player views a system at effective comms distance $D$, the server queries `CurrentTime - (D / CommsSpeed)`, retrieves that historical snapshot, and linearly interpolates ship positions along their last known straight-line velocity vectors.