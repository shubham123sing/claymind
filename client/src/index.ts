import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { bus } from './core/event-bus.js';
import { PanelSystem } from './panel.js';
import { input, InputHubSystem } from './platform/input/input-system.js';
import { SurfaceSystem } from './platform/surface/surface-system.js';
import { ObjectSystem } from './objects/object-system.js';
import { ImpactSystem } from './physics/impact-system.js';
import { SculptSystem } from './sculpt/sculpt-system.js';
import { DeleteSystem } from './ui/delete-creation.js';
import { DownloadSystem } from './ui/download-dialog.js';
import { SceneActionsSystem } from './ui/scene-actions.js';
import { ColorPickerSystem } from './ui/color-picker.js';
import { LibrarySystem } from './ui/library.js';
import { PlayKitSystem } from './playkit/playkit-system.js';
import { GameAgentSystem } from './game-agent/game-agent-system.js';
import { PointSaySystem } from './game-agent/point-say.js';
import { MultiplayerSystem } from './multiplayer/multiplayer-system.js';
import { room } from './multiplayer/room-client.js';
import { PresenceSystem } from './multiplayer/presence.js';
import { SharedClaySystem } from './multiplayer/shared-clay.js';
import { SharedPlaySystem } from './multiplayer/shared-play.js';
import { SettingsSystem } from './ui/settings-panel.js';
import { TutorialSystem } from './ui/tutorial.js';
import { MaterialPickerSystem } from './ui/material-picker.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __world: world, __bus: bus, __input: input, __room: room });
  world.registerSystem(PanelSystem);
  world.registerSystem(SurfaceSystem);
  {
    // order matters (same priority = registration order): input first, then
    // objects (they claim hands they hold), then sculpting (uses unclaimed hands)
    world.registerSystem(InputHubSystem);
    world.registerSystem(MaterialPickerSystem); // before objects: a click on the picker never grabs what is behind it
    world.registerSystem(ColorPickerSystem);
    world.registerSystem(LibrarySystem);
    world.registerSystem(PlayKitSystem); // before objects: a click on its panels never grabs what is behind
    world.registerSystem(GameAgentSystem); // optional game agent: its panels before objects too
    world.registerSystem(PointSaySystem); // Point + Say gestures: a marking pinch before objects grab it
    world.registerSystem(MultiplayerSystem); // room panel before objects too
    world.registerSystem(PresenceSystem); // sets the table frame on joining: before the shared systems
    world.registerSystem(SharedClaySystem);
    world.registerSystem(SharedPlaySystem);
    world.registerSystem(SettingsSystem);
    world.registerSystem(TutorialSystem);
    world.registerSystem(ObjectSystem);
    world.registerSystem(ImpactSystem);
    world.registerSystem(SculptSystem);
    world.registerSystem(DeleteSystem);
    world.registerSystem(DownloadSystem);
    world.registerSystem(SceneActionsSystem);
    // ?debug: systems by stable names (class names are minified in release builds)
    if (new URLSearchParams(location.search).has('debug')) {
      Object.assign(window, {
        __sys: {
          sculpt: world.getSystem(SculptSystem), objects: world.getSystem(ObjectSystem), library: world.getSystem(LibrarySystem), playkit: world.getSystem(PlayKitSystem), gameAgent: world.getSystem(GameAgentSystem), multiplayer: world.getSystem(MultiplayerSystem),
          coach: world.getSystem(TutorialSystem), settings: world.getSystem(SettingsSystem),
        },
      });
    }
  }
});
