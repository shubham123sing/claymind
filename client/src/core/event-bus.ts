/** Tiny typed event bus. Keeps systems decoupled (sculpt, physics, KG, UI). */
export type Handler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) (h as Handler<Events[K]>)(payload);
  }
}

export type Handedness = 'left' | 'right';

/** Events shared across the app. Extend as phases add systems. */
export type AppEvents = {
  /** A sculpt was baked into an object; the object system spawns it. */
  'creation:baked': {
    creation: import('../objects/creation.js').Creation;
    baked: import('../objects/bake.js').BakedObject;
    /** World pose of the object's origin (bbox centre) and orientation. */
    position: [number, number, number];
    quaternion: [number, number, number, number];
    /** The sculpt as it was (grid-local geometry, for AI renders) and its scale. */
    sculptGeometries: import('three').BufferGeometry[];
    scale: number;
    /** Local template ranking (best first). */
    ranking: { id: string; similarity: number }[];
  };
  /** Toggle AI on / off. */
  'ai:toggle': Record<string, never>;
  /** Ask the agent to test its beliefs (Debug the Brain). */
  'agent:check': Record<string, never>;
  /** Show / hide the Mastery screen. */
  'mastery:toggle': Record<string, never>;
  /** Ask the object system to cycle the focused object's material. */
  'object:cycle-material': Record<string, never>;
  /** Open / close the material picker for the piece last touched. */
  'material:toggle': Record<string, never>;
  /** Open / close the colour picker (clay piece or the touched object piece). */
  'color:toggle': Record<string, never>;
  /** Join the focused object with the one touching it / separate its focused piece. */
  'object:join': Record<string, never>;
  'object:separate': Record<string, never>;
  /** A creation in the room changed (materials, colour, pieces, pinned): the Library saves it. */
  'creation:changed': { creationId: string };
  /** A creation stopped existing on its own (joined into another): the Library drops it. */
  'creation:removed': { creationId: string };
  /** Pin / unpin the touched object; spawn the Play Kit; open / close the Library. */
  'object:pin': Record<string, never>;
  'playkit:spawn': Record<string, never>;
  'library:toggle': Record<string, never>;
  'settings:toggle': Record<string, never>;
  /** Browser tool menu shown or hidden with its round button. */
  'ui:tools': { open: boolean };
  'tutorial:start': Record<string, never>;
  /** Tutorial signals: the clay was shaped / painted (or coloured); an object was pinned. */
  'clay:touched': Record<string, never>;
  'clay:painted': Record<string, never>;
  'object:pinned': { creationId: string };
  /** A short message for the player (shown above the clay). */
  'ui:toast': { text: string; color?: string };
  /** A creation's material changed: by the user (a correction the brain learns from) or by the AI estimate. */
  /** A part's material changed (`part` = index into creation.parts); materialId is then the creation's main material. */
  'object:material-set': { creationId: string; materialId: string; by: 'user' | 'ai'; confidence: number; part?: number; partMaterialId?: string };
  /**
   * Ask the object system to change a creation's material (e.g. after the AI looked at it).
   * With `part`: that part only. Without: every part the player has not set themselves.
   */
  'creation:set-material': { creationId: string; materialId: string; by: 'user' | 'ai'; confidence: number; part?: number };
  /** The vision model described a creation (validated suggestion). */
  'creation:described': { creationId: string; result: import('../ai/types.js').DescribeResult };
  /** A cleaner model arrived for a creation (object-local metres, centred). */
  'creation:model': { creationId: string; mesh: import('../objects/bake.js').BakedMesh; source: 'ai' | 'cache' };
  /** One-line AI status for a creation's label ('' clears it). */
  'creation:ai-status': { creationId: string; text: string };
  /** The user picked up / interacted with a creation. */
  'object:focus': { creationId: string };
  /** Show / hide the brain. */
  'kg:toggle': Record<string, never>;
  'object:broke': { creationId: string; materialId: string; x: number; y: number; z: number };
  'hand:pinch-start': { hand: Handedness; x: number; y: number; z: number };
  'hand:pinch-end': { hand: Handedness; x: number; y: number; z: number };
  'physics:impact': {
    entityIndex: number;
    materialId: string;
    piece: boolean;
    impulse: number;
    deltaV: number;
    /** Unit direction of the velocity change (points away from the contact). */
    dir?: [number, number, number];
    x: number;
    y: number;
    z: number;
  };
};

export const bus = new EventBus<AppEvents>();
