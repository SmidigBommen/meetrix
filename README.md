# Meetrix

Meeting-room door display on a 32x32 LED matrix. Two keys: +15 minutes, and take back the last 15 minutes.

- `firmware/` portable C. Hardware access is limited to the list in `hal.h`.
- `sim/sim.mjs` simulated electronics, bridge and mock Microsoft 365. `sim/test.mjs` tests them with the firmware.
- `simulator.html` is generated. Edit `sim/page.html` and rebuild.

Needs Zig and Node. `npm install`, then `npm run build` or `npm test`.

## Enclosure

- `enclosure/box.mjs` parametric model, sizes in mm at the top of the file.
- `npm run enclosure` checks the parts for collisions and writes `enclosure/stl/*.stl` and the 3D viewer `enclosure/meetrix-enclosure.html`.
