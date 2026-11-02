import { open, rename, unlink, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Checkpoint } from './store.ts';
export async function atomicJson(path: string, value: unknown, replace = rename) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx');
  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } catch (error) { await file.close(); await unlink(temp).catch(() => {}); throw error; }
  await file.close();
  try { await replace(temp, path); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
export async function preserveLegacy(store: Checkpoint, progressPath: string, outputPath: string) {
  for (const path of [progressPath, outputPath]) {
    let raw: string;
    try { raw = await readFile(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
    const data = JSON.parse(raw);
    if (data.collection?.checkpointVersion === 1) continue;
    store.transaction(() => {
      store.preserveLegacy(path, data);
      // Old completion markers do not prove that the corresponding data was saved.
      if (Array.isArray(data.completedTeams)) for (const id of data.completedTeams) {
        if (typeof id !== 'string' || !/^Q\d+$/.test(id)) throw new Error('Invalid legacy team');
        store.enqueue({ kind: 'members', id, after: '' });
      }
    });
  }
}
