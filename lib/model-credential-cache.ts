import { invalidateModelsCache } from "./models-cache";

/**
 * Credential mutations can commit before Pi finishes refreshing its local
 * model/auth snapshot. Always invalidate Pi Web's independent cache even when
 * Pi reports that post-commit synchronization failure to the caller.
 */
export async function withModelsCacheInvalidation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } finally {
    invalidateModelsCache();
  }
}
