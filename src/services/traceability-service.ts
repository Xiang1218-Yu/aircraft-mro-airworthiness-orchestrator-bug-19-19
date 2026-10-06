import type { TraceabilityRecord } from '../domain/types.js';
import { Store } from '../store/store.js';

export class TraceabilityService {
  constructor(private readonly store: Store) {}

  recordInstall(record: TraceabilityRecord): void {
    // Duplicate callback: this exact record is already confirmed — history is immutable.
    if (this.store.traceability.has(record.id)) return;

    const key = `${record.engineId}:${record.position}`;
    const currentId = this.store.currentEngineConfiguration.get(key);
    const current = currentId ? this.store.traceability.get(currentId) : undefined;

    if (current) {
      if (current.stockId === record.stockId) {
        // Repeated/late callback for the part that is already current: no state change.
        this.store.addAudit('system', 'engine-part.install-ignored', 'traceability', record.id, { engineId: record.engineId, position: record.position, stockId: record.stockId, reason: 'already-current' });
        return;
      }
      if (record.occurredAt < current.occurredAt) {
        // Late callback predating the confirmed current record must not rewrite it.
        this.store.addAudit('system', 'engine-part.install-ignored', 'traceability', record.id, { engineId: record.engineId, position: record.position, stockId: record.stockId, reason: 'stale' });
        return;
      }
      // Replacement: close out the old part by appending a REPLACED record.
      // The historical INSTALLED record is never mutated.
      const replaced: TraceabilityRecord = {
        id: this.store.nextId('trace'),
        engineId: record.engineId,
        position: record.position,
        stockId: current.stockId,
        workOrderId: record.workOrderId,
        action: 'REPLACED',
        occurredAt: record.occurredAt,
      };
      this.store.traceability.set(replaced.id, replaced);
      this.store.addAudit('system', 'engine-part.replaced', 'traceability', replaced.id, { engineId: record.engineId, position: record.position, oldStockId: current.stockId, newStockId: record.stockId });
      this.store.addOutbox('system', 'mro.engine-part-replaced', record.engineId, { engineId: record.engineId, position: record.position, oldStockId: current.stockId, newStockId: record.stockId, workOrderId: record.workOrderId });
    }

    // The new current relation is formed only by appending the new record.
    this.store.traceability.set(record.id, { ...record });
    this.store.currentEngineConfiguration.set(key, record.id);
    this.store.addAudit('system', 'engine-part.installed', 'traceability', record.id, { engineId: record.engineId, position: record.position, stockId: record.stockId });
    this.store.addOutbox('system', 'mro.engine-part-installed', record.engineId, { engineId: record.engineId, position: record.position, stockId: record.stockId, workOrderId: record.workOrderId });
  }

  recordRemove(engineId: string, position: string, stockId: string, workOrderId: string, occurredAt: string): void {
    const key = `${engineId}:${position}`;
    const currentId = this.store.currentEngineConfiguration.get(key);
    const current = currentId ? this.store.traceability.get(currentId) : undefined;
    if (!current) {
      // Duplicate/late callback: nothing is current, so there is nothing to remove.
      // Confirmed history must not gain a fabricated REMOVED record.
      this.store.addAudit('system', 'engine-part.remove-ignored', 'traceability', key, { engineId, position, stockId, reason: 'not-installed' });
      return;
    }
    if (current.stockId !== stockId) throw new Error('part is not current');
    if (occurredAt < current.occurredAt) {
      // Late callback predating the confirmed install must not tear it down.
      this.store.addAudit('system', 'engine-part.remove-ignored', 'traceability', current.id, { engineId, position, stockId, reason: 'stale' });
      return;
    }
    const record: TraceabilityRecord = { id: this.store.nextId('trace'), engineId, position, stockId, workOrderId, action: 'REMOVED', occurredAt };
    this.store.traceability.set(record.id, record);
    this.store.currentEngineConfiguration.delete(key);
    this.store.addAudit('system', 'engine-part.removed', 'traceability', record.id, { engineId, position, stockId, workOrderId });
    this.store.addOutbox('system', 'mro.engine-part-removed', engineId, { engineId, position, stockId, workOrderId });
  }
}
