// =====================================================================
//  Baixa todos os arquivos do bucket "media" do Supabase para uma pasta.
//  Usado pelo backup semanal (.github/workflows/backup.yml), mas roda no
//  computador também:
//    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup-storage.mjs pasta
//  A service_role key só existe aqui e nos segredos do GitHub: nunca no site.
// =====================================================================
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.STORAGE_BUCKET || 'media';
const OUT = process.argv[2] || 'backup/storage';
if (!URL_ || !KEY) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// lista uma "pasta" do bucket (de 1000 em 1000); pastas vêm com id nulo
async function list(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`Não foi possível listar "${prefix || '/'}": ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function walk(prefix = '') {
  let files = 0, bytes = 0;
  for (const item of await list(prefix)) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      const sub = await walk(path);
      files += sub.files; bytes += sub.bytes;
      continue;
    }
    const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers });
    if (!res.ok) throw new Error(`Não foi possível baixar "${path}": ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    const dest = join(OUT, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, data);
    files++; bytes += data.length;
  }
  return { files, bytes };
}

const { files, bytes } = await walk();
console.log(`${files} arquivo(s) do bucket "${BUCKET}" salvos em ${OUT} (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
