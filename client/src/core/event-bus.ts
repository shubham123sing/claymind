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
  };
  /** Ask the object system to cycle the focused object's material. */
  'object:cycle-material': Record<string, never>;
  /** The user changed a creation's material (a correction the brain learns from). */
  'object:material-set': { creationId: string; materialId: string };
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
    x: number;
    y: number;
    z: number;
  };
};

export const bus = new EventBus<AppEvents>();
