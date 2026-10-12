'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');

require('dotenv').config({
  path: path.join(root, '.env.local'),
  quiet: true
});

const { Pool } = require('pg');
const files = JSON.parse(
  fs.readFileSync(path.join(root, 'songs.json'), 'utf8')
);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing; import cancelled.');
  process.exit(1);
}

if (!Array.isArray(files) || !files.length) {
  console.error('songs.json is empty or invalid.');
  process.exit(1);
}

for (const file of files) {
  if (
    typeof file !== 'string' ||
    path.basename(file) !== file ||
    !fs.existsSync(path.join(root, 'mshub', file))
  ) {
    console.error('Invalid or missing audio file:', file);
    process.exit(1);
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 10000
});

(async () => {
  let imported = 0;

  try {
    await pool.query('BEGIN');

    for (const file of files) {
      const title = file.replace(/\.mp3$/i, '');

      await pool.query(
        `INSERT INTO songs
          (title, artist, audio_key, is_published)
         VALUES ($1, NULL, $2, TRUE)
         ON CONFLICT (audio_key) DO UPDATE SET
           title = EXCLUDED.title,
           is_published = TRUE,
           updated_at = NOW()`,
        [title, `mshub/${file}`]
      );

      imported++;
    }

    await pool.query('COMMIT');
    console.log(`Catalog synchronized: ${imported} tracks processed.`);
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Import failed; transaction rolled back:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
