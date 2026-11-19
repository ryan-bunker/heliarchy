- Need auto repeat building queues
- Navigation is poor, need a better way to jump to related things (like easily going to the planet that a ship is orbiting)
- Scouting feels quite a bit faster than expansion/economy. By the time I had established my first interstellar colony I already had telemetry on dozens of planets.
- The panels are getting a little jumbled with mixed information scattered all over the place. The right panel is okay, but the navigation panel is right in the middle of the star info panel.
- There's a bug where the "Known Colonies" list only shows the pretty name of the homeworld and every other colony just shows it's truncated ID (0x94FE*E27D* etc)

# Right Panel Layout

Let's try this layout:
+-------------------- // star info
| () Canpux-381 (M-Class) [SCANNED]
| Star ID: 0x94FE_E27D_6000_0000 \* Cell (21499, 10198)
| Orbiting Planets (5)
| <planet list>
+-------------------- // planet info
| Canpux-381 Prime [PLAYER COLONY]
| ID: x94FE_E27D_6000_0020
| {Center on Planet} {Lock to 1m Orbit}
| <ships in orbit list> // make sure there is a way to select each ship to interact with it
| <orbital telemetry>
| <planet stats>
| <mineral info>
| <economy info>
| <production queue / buttons>
+-------------------- // ship info
| <ship name>
| <class info/stats>
| <location info> // make the [In Orbit] tag a button that selects the thing being orbited
| <cargo loadout>
| <quick load/unload buttons and management button>
+--------------------
