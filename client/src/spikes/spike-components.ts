import { createComponent, Types } from '@iwsdk/core';

/** Tags a dynamic test body created by the Phase 0 spikes. */
export const SpikeBody = createComponent('SpikeBody', {
  radius: { type: Types.Float32, default: 0.03 },
  massKg: { type: Types.Float32, default: 0.1 },
  /** 1 = launched fast to test tunnelling (CCD). */
  fastShot: { type: Types.Int8, default: 0 },
});
