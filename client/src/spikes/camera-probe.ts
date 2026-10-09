/**
 * Spike 3: can the app read camera frames (on Quest: passthrough cameras?)
 * Uses IWSDK CameraSource (getUserMedia) and CameraUtils.captureFrame().
 * Result is printed to the HUD and console; it never blocks the game.
 */
import { CameraSource, CameraUtils, World } from '@iwsdk/core';
import { spike } from './spike-state.js';

let running = false;

export async function runCameraProbe(world: World): Promise<void> {
  if (running) return;
  running = true;
  const hud = spike.hud;
  const report = (msg: string) => {
    hud?.set('camera', msg);
    console.info('[spike:camera]', msg);
  };
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      report('NO getUserMedia in this browser');
      return;
    }
    report('requesting camera…');
    const devices = await CameraUtils.getDevices(true).catch(() => []);
    const entity = world.createTransformEntity();
    entity.addComponent(CameraSource, { facing: 'back', width: 1280, height: 960, frameRate: 30 });
    const t0 = performance.now();
    while (performance.now() - t0 < 15000) {
      const state = entity.getValue(CameraSource, 'state');
      if (state === 'active' || state === 'error') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const state = entity.getValue(CameraSource, 'state');
    if (state !== 'active') {
      report(`FAILED state=${state} after ${((performance.now() - t0) / 1000).toFixed(1)}s, devices=${devices.length}`);
      entity.dispose();
      return;
    }
    await new Promise((r) => setTimeout(r, 500)); // let a real frame arrive
    const canvas = CameraUtils.captureFrame(entity);
    const stream = entity.getValue(CameraSource, 'stream') as MediaStream | null;
    const label = stream?.getVideoTracks()[0]?.label ?? '?';
    report(
      canvas
        ? `OK frame ${canvas.width}x${canvas.height} "${label.slice(0, 28)}" devices=${devices.length}`
        : `ACTIVE but captureFrame=null "${label.slice(0, 28)}"`,
    );
    stream?.getTracks().forEach((t) => t.stop());
    entity.dispose();
  } catch (err) {
    report(`ERROR ${(err as Error).name}: ${(err as Error).message}`.slice(0, 64));
  } finally {
    running = false;
  }
}
