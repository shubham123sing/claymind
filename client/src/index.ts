import { CameraSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { bus } from './core/event-bus.js';
import { Hud } from './devtools/hud.js';
import { PanelSystem } from './panel.js';
import { InputHubSystem } from './platform/input/input-system.js';
import { SurfaceSystem } from './platform/surface/surface-system.js';
import { AgentSystem } from './agent/agent-system.js';
import { ExperimentSystem } from './agent/experiment-system.js';
import { devAi, devKgView } from './core/flags.js';
import { AiSystem } from './ai/ai-system.js';
import { KGSystem } from './kgview/kg-system.js';
import { ObjectSystem } from './objects/object-system.js';
import { ImpactSystem } from './physics/impact-system.js';
import { SculptSystem } from './sculpt/sculpt-system.js';
import { DeleteSystem } from './ui/delete-creation.js';
import { DownloadSystem } from './ui/download-dialog.js';
import { SceneActionsSystem } from './ui/scene-actions.js';
import { ColorPickerSystem } from './ui/color-picker.js';
import { LibrarySystem } from './ui/library.js';
import { PlayKitSystem } from './playkit/playkit-system.js';
import { HelperSystem } from './helper/helper-system.js';
import { SettingsSystem } from './ui/settings-panel.js';
import { CoachSystem } from './ui/coach.js';
import { MaterialPickerSystem } from './ui/material-picker.js';
import { BallSpawnerSystem } from './spikes/ball-spawner-system.js';
import { ImpactProbeSystem } from './spikes/impact-probe-system.js';
import { PinchProbeSystem } from './spikes/pinch-probe-system.js';
import { spike } from './spikes/spike-state.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __world: world, __bus: bus });
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
    // order matters (same priority = registration order): input first, then
    // objects (they claim hands they hold), then sculpting (uses unclaimed hands)
    world.registerSystem(InputHubSystem);
    world.registerSystem(MaterialPickerSystem); // before objects: a click on the picker never grabs what is behind it
    world.registerSystem(ColorPickerSystem);
    world.registerSystem(LibrarySystem);
    world.registerSystem(PlayKitSystem); // before objects: a click on its panels never grabs what is behind
    world.registerSystem(HelperSystem); // optional AI helper (Update 2): panels before objects too
    world.registerSystem(SettingsSystem);
    world.registerSystem(CoachSystem);
    world.registerSystem(KGSystem); // claims hands that grab the brain before objects / sculpting
    world.registerSystem(ObjectSystem);
    world.registerSystem(ImpactSystem);
    world.registerSystem(SculptSystem);
    world.registerSystem(DeleteSystem);
    world.registerSystem(DownloadSystem);
    world.registerSystem(SceneActionsSystem);
    if (devAi) world.registerSystem(AiSystem); // plan v4: no AI and no network unless ?devAi
    world.registerSystem(ExperimentSystem);
    // Debug-the-Brain agent + Mastery: development only in plan v3 (experiments stay, for Predict then Test)
    if (devKgView) world.registerSystem(AgentSystem);
    // ?debug: systems by stable names (class names are minified in release builds)
    if (new URLSearchParams(location.search).has('debug')) {
      Object.assign(window, {
        __sys: {
          sculpt: world.getSystem(SculptSystem), objects: world.getSystem(ObjectSystem), library: world.getSystem(LibrarySystem), playkit: world.getSystem(PlayKitSystem), helper: world.getSystem(HelperSystem),
          coach: world.getSystem(CoachSystem), settings: world.getSystem(SettingsSystem),
        },
      });
    }
  }
});
