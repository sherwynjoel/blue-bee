import * as FileSystem from 'expo-file-system';
import type { OutboxItem, OutboxStore } from './outbox-store';

/**
 * Durable per-order chat outbox persistence via expo-file-system (Increment 18) — realises the
 * cross-relaunch persistence `LocationOutbox` explicitly deferred, so a message composed offline
 * survives an app kill and syncs on next launch. One JSON file per order under the app document
 * directory. All I/O is best-effort: a failed read/write never crashes the send path (the in-memory
 * queue still works this session; only durability degrades).
 */
export class FileOutboxStore implements OutboxStore {
  private readonly uri: string;

  constructor(orderId: string) {
    const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
    this.uri = `${dir}bluebee-chat-outbox-${orderId}.json`;
  }

  async load(): Promise<OutboxItem[]> {
    try {
      const info = await FileSystem.getInfoAsync(this.uri);
      if (!info.exists) return [];
      const raw = await FileSystem.readAsStringAsync(this.uri);
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
    } catch {
      return [];
    }
  }

  async save(items: OutboxItem[]): Promise<void> {
    try {
      await FileSystem.writeAsStringAsync(this.uri, JSON.stringify(items));
    } catch {
      // best-effort durability — never throw into the send path
    }
  }
}
