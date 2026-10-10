/**
 * ClayMind's physics runtime: IWSDK 1.0.1's PhysicsRuntime (runs inside IWSDK's
 * physics worker), extended with Havok features IWSDK does not expose yet.
 * Swapped in by the `claymindPhysicsRuntime` Vite plugin (vite.config.ts) for
 * the worker's own `./physics-runtime.js` import; the main-thread PhysicsSystem
 * is unchanged.
 * Phase 6a (plan v4): only proves the swap works in dev and in the build.
 */
import { PhysicsRuntime as IwsdkPhysicsRuntime } from '../../../node_modules/@iwsdk/core/dist/physics/physics-runtime.js';

export const CLAYMIND_RUNTIME = 'claymind-physics-runtime-ext';
console.info(`[physics] ${CLAYMIND_RUNTIME} loaded in the physics worker`);

export class PhysicsRuntime extends IwsdkPhysicsRuntime {}
