import { defineComponents } from '@iwsdk/core';
import { PhysObject } from './objects/object-components.js';
import { SpikeBody } from './spikes/spike-components.js';

export default defineComponents([SpikeBody, PhysObject]);
