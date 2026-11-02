import { Checkpoint } from '../../scripts/wikidata/store.ts';
const store = new Checkpoint(process.argv[2]); store.acquire();
const job = { kind: 'entity', id: 'Q1', role: 'player' } as const;
store.enqueue(job);
const entity = { id: 'Q1', lastrevid: 1, claims: {} };
if (process.argv[3] === 'committed') store.commit(job, [], entity);
else {
  store.db.exec('BEGIN IMMEDIATE');
  store.db.prepare('INSERT INTO entities VALUES(?,?,?)').run('Q1', JSON.stringify(entity), '2026-11-01');
  store.db.prepare('UPDATE jobs SET done=1').run();
}
process.send?.('ready');
setInterval(() => {}, 1000);
