import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { bus } from './core/event-bus.js';
import { PanelSystem } from './panel.js';
import { TextEntrySystem } from './ui/text-entry.js';
import { input, InputHubSystem } from './platform/input/input-system.js';
import { handNoise } from './platform/input/xr-hands-provider.js';
import { PerfGovernorSystem } from './platform/perf-governor.js';
import { quality } from './core/quality.js';
import { RoomSystem } from './platform/environment/room-system.js';
import { surface, SurfaceSystem } from './platform/surface/surface-system.js';
import { ObjectSystem } from './objects/object-system.js';
import { ImpactSystem } from './physics/impact-system.js';
import { SculptSystem } from './sculpt/sculpt-system.js';
import { DeleteSystem } from './ui/delete-creation.js';
import { DownloadSystem } from './ui/download-dialog.js';
import { SceneActionsSystem } from './ui/scene-actions.js';
import { AutosaveSystem } from './storage/autosave-system.js';
import { DailyChallengeSystem } from './ui/daily-challenge-system.js';
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
import { SharedBodiesSystem } from './multiplayer/shared-bodies.js';
import { SettingsSystem } from './ui/settings-panel.js';
import { TutorialSystem } from './ui/tutorial.js';
import { MaterialPickerSystem } from './ui/material-picker.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __world: world, __bus: bus, __input: input, __room: room, __surface: surface, __handNoise: handNoise, __quality: quality });
  world.registerSystem(PanelSystem);
  world.registerSystem(PerfGovernorSystem); // frame-rate governor: quality steps down when slow (V6)
  world.registerSystem(SurfaceSystem);
  world.registerSystem(RoomSystem); // the VR studio room (hidden in mixed reality)
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
    world.registerSystem(SharedBodiesSystem); // living objects shared with the room
    world.registerSystem(SettingsSystem);
    world.registerSystem(TextEntrySystem); // the pinch keypad for names (hands only)
    world.registerSystem(TutorialSystem);
    world.registerSystem(ObjectSystem);
    world.registerSystem(ImpactSystem);
    world.registerSystem(SculptSystem);
    world.registerSystem(DeleteSystem);
    world.registerSystem(DownloadSystem);
    world.registerSystem(SceneActionsSystem);
    world.registerSystem(AutosaveSystem); // the clay and loose creations survive a crash (V6)
    world.registerSystem(DailyChallengeSystem); // one small goal a day, from the date (V6 4.5)
    // ?debug: systems by stable names (class names are minified in release builds)
    if (new URLSearchParams(location.search).has('debug')) {
      Object.assign(window, {
        __sys: {
          sculpt: world.getSystem(SculptSystem), objects: world.getSystem(ObjectSystem), library: world.getSystem(LibrarySystem), playkit: world.getSystem(PlayKitSystem), gameAgent: world.getSystem(GameAgentSystem), pointSay: world.getSystem(PointSaySystem), multiplayer: world.getSystem(MultiplayerSystem),
          coach: world.getSystem(TutorialSystem), settings: world.getSystem(SettingsSystem), autosave: world.getSystem(AutosaveSystem), daily: world.getSystem(DailyChallengeSystem),
        },
      });
    }
  }
});
