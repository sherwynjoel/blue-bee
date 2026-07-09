import * as FileSystem from 'expo-file-system';
import type { WeighQueueItem, WeighOutboxStore } from './weigh-outbox';

/**
 * Durable weigh-outbox persistence via expo-file-system (Inc-23 P2) — mirrors the proven chat
 * `FileOutboxStore`. A single JSON file under the app document directory holds ALL queued weigh
 * approvals (a driver has few concurrent stops), so an approval made offline survives an app kill and
 * syncs on next launch. All I/O is best-effort: a failed read/write never crashes the approve path.
 */
export class FileWeighOutboxStore implements WeighOutboxStore {
  private readonly uri: string;

  constructor() {
    const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
    this.uri = `${dir}bluebee-weigh-outbox.json`;
  }

  async load(): Promise<WeighQueueItem[]> {
    try {
      const info = await FileSystem.getInfoAsync(this.uri);
      if (!info.exists) return [];
      const raw = await FileSystem.readAsStringAsync(this.uri);
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as WeighQueueItem[]) : [];
    } catch {
      return [];
    }
  }

  async save(items: WeighQueueItem[]): Promise<void> {
    try {
      await FileSystem.writeAsStringAsync(this.uri, JSON.stringify(items));
    } catch {
      // best-effort durability — never throw into the approve path
    }
  }
}
