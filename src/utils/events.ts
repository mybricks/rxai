type Handle<T> = (params: T) => void;

const EMPTY_CACHE = Symbol("EMPTY_CACHE");

class Events<TMap extends object> {
  private events = new Map<
    keyof TMap,
    {
      cache: typeof EMPTY_CACHE | TMap[keyof TMap];
      handles: Set<Handle<TMap[keyof TMap]>>;
    }
  >();

  on<K extends keyof TMap>(key: K, handle: Handle<TMap[K]>) {
    let event = this.events.get(key);
    if (!event) {
      this.events.set(
        key,
        (event = {
          cache: EMPTY_CACHE,
          handles: new Set(),
        }),
      );
    }
    event.handles.add(handle as Handle<TMap[keyof TMap]>);
  }

  onWithCache<K extends keyof TMap>(key: K, handle: Handle<TMap[K]>) {
    let event = this.events.get(key);
    if (!event) {
      this.events.set(
        key,
        (event = {
          cache: EMPTY_CACHE,
          handles: new Set(),
        }),
      );
    }
    if (event.cache !== EMPTY_CACHE) {
      handle(event.cache as TMap[K]);
    }
    event.handles.add(handle as Handle<TMap[keyof TMap]>);
  }

  off<K extends keyof TMap>(key: K, handle: Handle<TMap[K]>) {
    const event = this.events.get(key);
    if (event) {
      event.handles.delete(handle as Handle<TMap[keyof TMap]>);
    }
  }

  emit<K extends keyof TMap>(key: K, value: TMap[K]) {
    const event = this.events.get(key);
    if (event) {
      event.cache = value;
      event.handles.forEach((handle) => {
        handle(value);
      });
    }
  }
}

export { Events };
