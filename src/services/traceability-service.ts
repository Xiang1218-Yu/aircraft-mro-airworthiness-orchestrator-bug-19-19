import type { TraceabilityRecord } from '../domain/types.js';
import { Store } from '../store/store.js';

// Actions that close a current relationship: the part leaves the position.
const CLOSING_ACTIONS: Array<TraceabilityRecord['action']> = ['REMOVED', 'REPLACED'];

export class TraceabilityService {
  constructor(private readonly store: Store) {}

  recordInstall(record: TraceabilityRecord): void {
    // Duplicate callback: the record is already part of the confirmed history.
    const existing = this.store.traceability.get(record.id);
    if (existing) {
      if (existing.engineId !== record.engineId || existing.position !== record.position || existing.stockId !== record.stockId) {
        throw new Error('traceability record conflict');
      }
      return;
    }

    const key = `${record.engineId}:${record.position}`;
    const currentId = this.store.currentEngineConfiguration.get(key);
    const current = currentId ? this.store.traceability.get(currentId) : undefined;

    if (current) {
      if (current.stockId === record.stockId) {
        // Same serialized part reported again for the position it already
        // occupies: a duplicate callback, not a replacement.
        this.store.addAudit('system', 'engine-part.duplicate-install', 'traceability', current.id, { engineId: record.engineId, position: record.position, stockId: record.stockId });
        return;
      }
      if (record.occurredAt < current.occurredAt) {
        // Late callback: the position has already moved on, so confirmed
        // history must not be rewritten.
        this.store.addAudit('system', 'engine-part.stale-install', 'traceability', current.id, { engineId: record.engineId, position: record.position, stockId: record.stockId, occurredAt: record.occurredAt });
        return;
      }
      // Replacement: close the previous relationship by APPENDING an
      // immutable REPLACED record. The historical install record is never
      // rewritten.
      const closure: TraceabilityRecord = {
        id: this.store.nextId('trace'),
        engineId: current.engineId,
        position: current.position,
        stockId: current.stockId,
        workOrderId: record.workOrderId,
        action: 'REPLACED',
        occurredAt: record.occurredAt,
      };
      this.store.traceability.set(closure.id, closure);
      this.store.addAudit('system', 'engine-part.replaced', 'traceability', closure.id, { engineId: closure.engineId, position: closure.position, stockId: closure.stockId, replacedBy: record.stockId, workOrderId: record.workOrderId });
      this.store.addOutbox('system', 'mro.engine-part-replaced', closure.engineId, { recordId: closure.id, engineId: closure.engineId, position: closure.position, stockId: closure.stockId, replacedBy: record.stockId, workOrderId: record.workOrderId });
    }

    // The new current relationship is formed exclusively by appending a new
    // record and pointing the current configuration at it.
    this.store.traceability.set(record.id, { ...record });
    this.store.currentEngineConfiguration.set(key, record.id);
    this.store.addAudit('system', 'engine-part.installed', 'traceability', record.id, { engineId: record.engineId, position: record.position, stockId: record.stockId, workOrderId: record.workOrderId });
    this.store.addOutbox('system', 'mro.engine-part-installed', record.engineId, { recordId: record.id, engineId: record.engineId, position: record.position, stockId: record.stockId, workOrderId: record.workOrderId });
  }

  recordRemove(engineId: string, position: string, stockId: string, workOrderId: string, occurredAt: string): void {
    const key = `${engineId}:${position}`;
    const currentId = this.store.currentEngineConfiguration.get(key);
    const current = currentId ? this.store.traceability.get(currentId) : undefined;
    const history = [...this.store.traceability.values()].filter((item) => item.engineId === engineId && item.position === position && item.stockId === stockId);

    // Duplicate callback: this removal is already part of the confirmed history.
    if (history.some((item) => item.workOrderId === workOrderId && CLOSING_ACTIONS.includes(item.action))) return;

    if (!current || current.stockId !== stockId) {
      // The part is not installed at this position. If it was there before,
      // this is a late callback for an already confirmed removal/replacement
      // and must not change history.
      if (history.length > 0) {
        this.store.addAudit('system', 'engine-part.stale-removal', 'traceability', current?.id ?? key, { engineId, position, stockId, workOrderId });
        return;
      }
      throw new Error('part is not current');
    }

    if (occurredAt < current.occurredAt) {
      // Late callback predating the confirmed install: ignore it.
      this.store.addAudit('system', 'engine-part.stale-removal', 'traceability', current.id, { engineId, position, stockId, workOrderId, occurredAt });
      return;
    }

    const record: TraceabilityRecord = { id: this.store.nextId('trace'), engineId, position, stockId, workOrderId, action: 'REMOVED', occurredAt };
    this.store.traceability.set(record.id, record);
    this.store.currentEngineConfiguration.delete(key);
    this.store.addAudit('system', 'engine-part.removed', 'traceability', record.id, { engineId, position, stockId, workOrderId });
    this.store.addOutbox('system', 'mro.engine-part-removed', engineId, { recordId: record.id, engineId, position, stockId, workOrderId });
  }
}
