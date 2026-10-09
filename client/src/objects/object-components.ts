import { createComponent, Types } from '@iwsdk/core';

/** A physical creation (or one of its fracture pieces). */
export const PhysObject = createComponent('PhysObject', {
  materialId: { type: Types.String, default: 'clay' },
  massKg: { type: Types.Float32, default: 0.1 },
  /** 1 = fracture piece (never breaks again, has a lifetime). */
  piece: { type: Types.Int8, default: 0 },
  /** 1 while held by a hand / pointer (impacts ignored, gravity off). */
  held: { type: Types.Int8, default: 0 },
  /** performance.now() until which impacts are ignored (spawn / release). */
  ignoreImpactsUntil: { type: Types.Float64, default: 0 },
});
