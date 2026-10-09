import { CameraSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { Hud } from './devtools/hud.js';
import { PanelSystem } from './panel.js';
import { SurfaceSystem } from './platform/surface/surface-system.js';
import { SculptSystem } from './sculpt/sculpt-system.js';
import { BallSpawnerSystem } from './spikes/ball-spawner-system.js';
import { ImpactProbeSystem } from './spikes/impact-probe-system.js';
import { PinchProbeSystem } from './spikes/pinch-probe-system.js';
import { spike } from './spikes/spike-state.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __world: World }).__world = world;
  world.registerSystem(PanelSystem);
  world.registerSystem(SurfaceSystem);
  if (new URLSearchParams(location.search).has('spikes')) {
    // Phase 0 feasibility probes: ball drop, pinch jitter, impacts/CCD, camera.
    spike.hud = new Hud(world);
    // camera feature is off by default (no permission prompt for players); the probe needs it
    world.registerSystem(CameraSystem);
    world.registerSystem(PinchProbeSystem);
    world.registerSystem(BallSpawnerSystem);
    world.registerSystem(ImpactProbeSystem);
  } else {
    world.registerSystem(SculptSystem);
  }
});
