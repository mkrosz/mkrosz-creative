// =====================================================================
//  Instala tudo no Supabase com um comando:  npm run setup
//
//   1. Banco: roda supabase/schema.sql — tabelas, regras (RLS/policies),
//      funções, triggers, bucket de arquivos e dados iniciais. É seguro rodar
//      de novo: só cria/atualiza o que falta, sem apagar conteúdo.
//   2. Admin: torna o seu e-mail administrador (e cria o usuário, se ainda
//      não existir e você informar a service_role key).
//   3. Site: grava shared/config.js com a URL e a chave pública (anon).
//
//  Os dados vêm do arquivo .env (copie de .env.example) ou são perguntados.
// =====================================================================
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rl = createInterface({ input: stdin, output: stdout });
const log = (msg) => console.log(`  ${msg}`);
const ask = async (name, question, { optional = false } = {}) => {
  if (process.env[name]) return process.env[name].trim();
  const v = (await rl.question(`${question}${optional ? ' (Enter para pular)' : ''}: `)).trim();
  if (!v && !optional) throw new Error(`${name} é obrigatório.`);
  return v;
};

async function main() {
  console.log('\nInstalação do portfólio no Supabase\n');
  // Supabase > Project Settings > Database > Connection string (URI, "Session" ou "Direct")
  const DB_URL = await ask('DATABASE_URL', 'Connection string do banco (postgresql://...)');
  const SB_URL = (await ask('SUPABASE_URL', 'Project URL (https://xxxx.supabase.co)', { optional: true })).replace(/\/$/, '');
  const ANON = SB_URL ? await ask('SUPABASE_ANON_KEY', 'anon public key', { optional: true }) : '';
  const ADMIN_EMAIL = await ask('ADMIN_EMAIL', 'E-mail do admin do painel', { optional: true });
  // só para CRIAR o usuário, se ele ainda não existir (a chave nunca vai para o site)
  const SERVICE = ADMIN_EMAIL && SB_URL ? await ask('SUPABASE_SERVICE_ROLE_KEY', 'service_role key — só se o usuário ainda não existir', { optional: true }) : '';
  const PASSWORD = SERVICE ? await ask('ADMIN_PASSWORD', 'Senha do admin (mín. 8 caracteres)') : '';
  rl.close(); // daqui em diante não pergunta mais nada

  // o SSL vai pelas opções; o "sslmode" da URL faria o pg exigir certificado verificado
  const url = new URL(DB_URL);
  url.searchParams.delete('sslmode');
  const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    console.log('\n1/3 Banco');
    await db.query(await readFile(join(ROOT, 'supabase', 'schema.sql'), 'utf8'));
    const { rows } = await db.query(`
      select
        (select count(*) from pg_tables where schemaname = 'public') as tabelas,
        (select count(*) from pg_policies where schemaname in ('public', 'storage')) as policies,
        (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and not t.tgisinternal) as triggers`);
    log(`ok — ${rows[0].tabelas} tabelas, ${rows[0].policies} policies, ${rows[0].triggers} triggers, bucket "media".`);

    console.log('\n2/3 Admin');
    if (!ADMIN_EMAIL) log('pulado (sem e-mail).');
    else await setupAdmin(db, { email: ADMIN_EMAIL, sbUrl: SB_URL, service: SERVICE, password: PASSWORD });
  } finally {
    await db.end();
  }

  console.log('\n3/3 Site');
  if (SB_URL && ANON) {
    const p = join(ROOT, 'shared', 'config.js');
    const cfg = await readFile(p, 'utf8');
    await writeFile(p, cfg
      .replace(/export const SUPABASE_URL = '.*?';/, `export const SUPABASE_URL = '${SB_URL}';`)
      .replace(/export const SUPABASE_ANON_KEY = '.*?';/, `export const SUPABASE_ANON_KEY = '${ANON}';`));
    log('shared/config.js atualizado — o site e o painel já usam o Supabase.');
  } else {
    log('pulado (sem Project URL / anon key): edite shared/config.js à mão.');
  }
  console.log('\nPronto!\n');
}

async function setupAdmin(db, { email, sbUrl, service, password }) {
  const found = await db.query('select id from auth.users where lower(email) = lower($1)', [email]);
  if (!found.rowCount) {
    // criar o usuário precisa da API de administração (service_role)
    if (!service) {
      return log(`o usuário ${email} ainda não existe. Crie em Authentication > Users > Add user e rode de novo.`);
    }
    const res = await fetch(`${sbUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!res.ok) throw new Error(`não foi possível criar o usuário (${res.status}): ${await res.text()}`);
    log(`usuário ${email} criado.`);
  }
  await db.query(
    `insert into public.admins (user_id) select id from auth.users where lower(email) = lower($1) on conflict do nothing`,
    [email],
  );
  log(`${email} é administrador.`);
}

main()
  .catch((err) => { console.error(`\nErro: ${err.message}\n`); process.exitCode = 1; })
  .finally(() => rl.close());
