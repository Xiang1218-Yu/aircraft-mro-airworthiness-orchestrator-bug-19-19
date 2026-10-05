import type { TraceabilityRecord } from '../domain/types.js';
import { Store } from '../store/store.js';

export class TraceabilityService {
  constructor(private readonly store: Store) {}

  recordInstall(record: TraceabilityRecord): void {
    const key = `${record.engineId}:${record.position}`;
    const currentId = this.store.currentEngineConfiguration.get(key);
    if (currentId) {
      const previous = this.store.traceability.get(currentId);
      // BUG: updating the old record destroys the immutable historical snapshot.
      if (previous) previous.stockId = record.stockId;
    }
    this.store.traceability.set(record.id, { ...record });
    this.store.currentEngineConfiguration.set(key, record.id);
    this.store.addAudit('system', 'engine-part.installed', 'traceability', record.id, { engineId: record.engineId, stockId: record.stockId });
  }

  recordRemove(engineId: string, position: string, stockId: string, workOrderId: string, occurredAt: string): void {
    const key = `${engineId}:${position}`;
    const currentId = this.store.currentEngineConfiguration.get(key);
    const current = currentId ? this.store.traceability.get(currentId) : undefined;
    if (current && current.stockId !== stockId) throw new Error('part is not current');
    const record: TraceabilityRecord = { id: this.store.nextId('trace'), engineId, position, stockId, workOrderId, action: 'REMOVED', occurredAt };
    this.store.traceability.set(record.id, record);
    this.store.currentEngineConfiguration.delete(key);
  }
}
