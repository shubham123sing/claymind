/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSystem, SessionMode, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { bus } from './core/event-bus.js';

export class PanelSystem extends createSystem({}) {
  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('welcome-panel');
    const xrButton = panel?.getElementById('xr-button');
    const mrButton = panel?.getElementById('mr-button');
    const exitButton = panel?.getElementById('exit-button');
    if (xrButton == null || mrButton == null || exitButton == null) {
      return;
    }
    // the welcome card goes away with the browser tool menu (clean view)
    // (in the browser the card is drawn in screen space from its UIKit document, not the asset group)
    const card = (panel as unknown as { document?: { visible: boolean } }).document ?? panel!;
    this.cleanupFuncs.push(bus.on('ui:tools', (e) => (card.visible = e.open)));
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      mrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      return;
    }

    // VR first (ClayMind's studio room); mixed reality uses the player's own table (passthrough)
    const launchVR = () => this.world.launchXR({ sessionMode: SessionMode.ImmersiveVR });
    const launchMR = () => this.world.launchXR({ sessionMode: SessionMode.ImmersiveAR });
    const exitXR = () => this.world.exitXR();
    xrButton.addEventListener('click', launchVR);
    mrButton.addEventListener('click', launchMR);
    exitButton.addEventListener('click', exitXR);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchVR),
      () => mrButton.removeEventListener('click', launchMR),
      () => exitButton.removeEventListener('click', exitXR),
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        mrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
      }),
    );
  }
}
