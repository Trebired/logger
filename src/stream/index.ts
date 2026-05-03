import EventEmitter from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const logStream = Object.freeze({
  emitter,
  emit: emitter.emit.bind(emitter),
  on: emitter.on.bind(emitter),
  once: emitter.once.bind(emitter),
  off: typeof emitter.off === "function" ? emitter.off.bind(emitter) : emitter.removeListener.bind(emitter),
});

export { emitter, logStream };
