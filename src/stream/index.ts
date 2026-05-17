type StreamHandler = (...args: any[]) => void;

class SimpleEmitter {
  private listeners = new Map<string, Set<StreamHandler>>();

  emit(eventName: string, ...args: any[]): boolean {
    const handlers = this.listeners.get(eventName);
    if (!handlers || handlers.size === 0) return false;
    for (const handler of Array.from(handlers)) handler(...args);
    return true;
  }

  on(eventName: string, handler: StreamHandler): this {
    const handlers = this.listeners.get(eventName) || new Set<StreamHandler>();
    handlers.add(handler);
    this.listeners.set(eventName, handlers);
    return this;
  }

  once(eventName: string, handler: StreamHandler): this {
    const onceHandler: StreamHandler = (...args) => {
      this.off(eventName, onceHandler);
      handler(...args);
    };
    return this.on(eventName, onceHandler);
  }

  off(eventName: string, handler: StreamHandler): this {
    const handlers = this.listeners.get(eventName);
    if (!handlers) return this;
    handlers.delete(handler);
    if (handlers.size === 0) this.listeners.delete(eventName);
    return this;
  }

  removeListener(eventName: string, handler: StreamHandler): this {
    return this.off(eventName, handler);
  }
}

const emitter = new SimpleEmitter();

const logStream = Object.freeze({
  emitter,
  emit: emitter.emit.bind(emitter),
  on: emitter.on.bind(emitter),
  once: emitter.once.bind(emitter),
  off: emitter.off.bind(emitter),
});

export { emitter, logStream };
