/**
 * Spike 5: MediaPipe Hand Landmarker in a plain browser tab (tier C input).
 * Reports detection FPS, inference ms, hands found, and pinch state using the
 * same PinchDetector as the XR adapter (distances normalised by hand size).
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { PinchDetector } from '../platform/input/pinch-detector.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const video = document.getElementById('video') as HTMLVideoElement;
const canvas = document.getElementById('overlay') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const startBtn = document.getElementById('start') as HTMLButtonElement;

// Webcam landmarks have no metric scale; express pinch distance as a fraction
// of palm length (wrist -> middle MCP), which is ~8-9 cm on an adult hand.
const pinch = [
  new PinchDetector({ startDistance: 0.25, endDistance: 0.4, lostFrameGrace: 4 }),
  new PinchDetector({ startDistance: 0.25, endDistance: 0.4, lostFrameGrace: 4 }),
];
let pinchEvents = 0;

startBtn.onclick = async () => {
  startBtn.disabled = true;
  try {
    hud.textContent = 'loading model…';
    const t0 = performance.now();
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}vendor/mediapipe/wasm`);
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    const loadMs = performance.now() - t0;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    startBtn.remove();
    run(landmarker, loadMs, stream.getVideoTracks()[0].getSettings());
  } catch (err) {
    hud.textContent = `FAILED: ${(err as Error).message}`;
    startBtn.disabled = false;
  }
};

function run(landmarker: HandLandmarker, loadMs: number, cam: MediaTrackSettings): void {
  let lastVideoTime = -1;
  let frames = 0, fpsWindowStart = performance.now(), fps = 0, inferMs = 0;
  const loop = () => {
    requestAnimationFrame(loop);
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const t0 = performance.now();
    const result = landmarker.detectForVideo(video, t0);
    inferMs = inferMs * 0.9 + (performance.now() - t0) * 0.1;
    frames++;
    if (t0 - fpsWindowStart > 1000) {
      fps = (frames * 1000) / (t0 - fpsWindowStart);
      frames = 0;
      fpsWindowStart = t0;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const lines: string[] = [];
    for (let h = 0; h < 2; h++) {
      const lm = result.landmarks[h];
      if (!lm) {
        pinch[h].update(null);
        continue;
      }
      const palm = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y, lm[9].z - lm[0].z) || 1;
      const d = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y, lm[4].z - lm[8].z) / palm;
      if (pinch[h].update(d) === 'start') pinchEvents++;
      ctx.fillStyle = pinch[h].pinching ? '#ffb347' : '#5fd3ff';
      for (const p of lm) ctx.fillRect(p.x * canvas.width - 4, p.y * canvas.height - 4, 8, 8);
      const label = result.handedness[h]?.[0]?.categoryName ?? '?';
      lines.push(`hand ${h} (${label}): pinch ratio ${d.toFixed(2)} ${pinch[h].pinching ? 'PINCH' : ''}`);
    }
    hud.textContent =
      `camera ${cam.width}x${cam.height} @ ${cam.frameRate ?? '?'}  model load ${loadMs.toFixed(0)} ms\n` +
      `detect fps ${fps.toFixed(1)}   inference ${inferMs.toFixed(1)} ms\n` +
      `hands ${result.landmarks.length}   pinch starts ${pinchEvents}\n` +
      lines.join('\n');
  };
  loop();
}
