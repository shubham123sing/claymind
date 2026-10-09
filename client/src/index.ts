import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { Hud } from './devtools/hud.js';
import { PanelSystem } from './panel.js';
import { BallSpawnerSystem } from './spikes/ball-spawner-system.js';
import { ImpactProbeSystem } from './spikes/impact-probe-system.js';
import { PinchProbeSystem } from './spikes/pinch-probe-system.js';
import { spike } from './spikes/spike-state.js';
import { TableSystem } from './spikes/table-system.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  spike.hud = new Hud(world);
  spike.hud.set('phase', 'ClayMind Phase 0 spikes');
  world.registerSystem(PanelSystem);
  world.registerSystem(TableSystem);
  world.registerSystem(PinchProbeSystem);
  world.registerSystem(BallSpawnerSystem);
  world.registerSystem(ImpactProbeSystem);
});
