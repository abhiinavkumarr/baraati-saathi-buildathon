// Import a private wedding from a `saathi-import-v1` JSON file (§9).
// Prints counts only, never names or phone numbers.
// Usage: node --env-file-if-exists=.env --import tsx scripts/import-wedding.ts <file>
import { readFileSync } from 'node:fs';
import { getDb } from '../server/db.ts';
import { importWeddingData, type ImportFileV1 } from '../server/import.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node --import tsx scripts/import-wedding.ts <file>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, 'utf8')) as ImportFileV1;
const db = await getDb();
const summary = await importWeddingData(db, raw);
console.log(
  JSON.stringify(
    {
      ok: true,
      db: db.kind,
      replaced: summary.replaced,
      events: summary.events_count,
      info: summary.info_count,
      guests: summary.guests_count,
      hosts: summary.hosts_count,
      added_people: summary.added_people_count,
      with_rooms: summary.with_rooms,
      with_travel: summary.with_travel,
    },
    null,
    2,
  ),
);
process.exit(0);
