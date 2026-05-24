import { jsStorageBackend } from "./js.js";
import { nativeStorageBackend } from "./native.js";
import type { StorageBackend, StorageBackendName } from "./types.js";

let preferredBackend: StorageBackendName | null = null;

function setStorageBackendPreferenceForTests(value: StorageBackendName | null): void {
  preferredBackend = value;
}

function getStorageBackend(): StorageBackend {
  const native = nativeStorageBackend();
  if (preferredBackend === "native") {
    if (!native) throw new Error("native-storage-backend-unavailable");
    return native;
  }
  if (preferredBackend === "js") return jsStorageBackend;
  return native || jsStorageBackend;
}

export { getStorageBackend, setStorageBackendPreferenceForTests };
export type { StorageBackendName, StorageScanSnapshot } from "./types.js";
