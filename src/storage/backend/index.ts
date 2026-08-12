import { jsStorageBackend } from "./js.js";
import { nativeStorageBackend } from "./native.js";
import { PACKAGE_NAME } from "#qz1iteme01ng";
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

function activeStorageBackendNotice(): string {
  return getStorageBackend().name === "native"
  ? `${PACKAGE_NAME} using native storage backend`
  : `${PACKAGE_NAME} using JS fallback storage backend`;
}

export { activeStorageBackendNotice, getStorageBackend, setStorageBackendPreferenceForTests };
export type { StorageBackendName, StorageScanSnapshot } from "./types.js";
