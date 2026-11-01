-- =====================================================================
--  PORTFÓLIO — Schema Supabase
--  Rode este arquivo inteiro no SQL Editor do Supabase (uma vez só).
--  Cria: tabelas, índices, triggers, funções, RLS (policies), bucket de
--  storage e dados de exemplo.
-- =====================================================================


create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
--  ADMINS — quem pode editar o portfólio
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- security definer + search_path fixo: evita recursão de RLS e hijack de schema
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------
--  FUNÇÕES DE TRIGGER
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.slugify(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- dicionário qualificado: com search_path vazio, unaccent(text) não acha o "unaccent"
  select trim(both '-' from regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(value, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

-- Gera o slug (o endereço: #projeto/slug) a partir do título / nome quando vier
-- vazio. Depois de criado ele fica fixo: trocar o título não muda o link (o painel
-- manda o slug atual de volta; só gera de novo se você apagar o campo).
-- Nunca fica vazio (título sem letras vira "item") nem repetido: se já existir,
-- ganha -2, -3… em vez de dar erro ao salvar.
create or replace function public.fill_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source text := coalesce(to_jsonb(new) ->> 'title', to_jsonb(new) ->> 'name');
  base text;
  candidate text;
  n int := 1;
  taken boolean;
begin
  base := public.slugify(case when coalesce(new.slug, '') = '' then source else new.slug end);
  if base = '' then base := 'item'; end if;
  candidate := base;
  loop
    execute format('select exists (select 1 from %I.%I where slug = $1 and id <> $2)', tg_table_schema, tg_table_name)
      into taken using candidate, new.id;
    exit when not taken;
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  new.slug := candidate;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
--  SETTINGS — linha única com todos os textos, cores e seções do site
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                  smallint primary key default 1 check (id = 1),
  -- identidade
  site_name           text not null default 'Seu Nome',
  role                text not null default 'Designer UX/UI & Gráfico',
  logo_url            text,
  email               text,
  location            text,
  available_for_work  boolean not null default true,
  -- hero
  hero_eyebrow        text default 'Portfólio',
  hero_title          text default 'Design que *se sente.*',
  hero_subtitle       text default 'Interfaces, marcas e experiências criadas com intenção.',
  hero_cta_label      text default 'Ver projetos',
  -- destaque
  featured_project_id uuid,
  featured_eyebrow    text default 'Projeto destaque',
  -- projetos
  projects_title      text default 'Projetos selecionados',
  projects_subtitle   text default 'Filtre por categoria ou pesquise pelo nome.',
  -- sobre
  about_title         text default 'Sobre mim',
  about_text          text,
  about_image_url     text,
  skills              text[] not null default '{}',
  -- estudos
  studies_title       text default 'Formação & trajetória',
  studies_subtitle    text,
  -- footer
  footer_cta          text default 'Vamos criar algo juntos?',
  footer_text         text default 'Feito com cuidado.',
  -- cores (hex)
  color_accent        text not null default '#2f7bff',
  color_accent_2      text not null default '#00c2ff',
  color_bg_light      text not null default '#f3f7fd',
  color_fg_light      text not null default '#0a1a33',
  color_bg_dark       text not null default '#030a18',
  color_fg_dark       text not null default '#e6efff',
  default_theme       text not null default 'system' check (default_theme in ('light', 'dark', 'system')),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  REDES SOCIAIS (links do perfil)
-- ---------------------------------------------------------------------
create table if not exists public.social_links (
  id         uuid primary key default gen_random_uuid(),
  platform   text not null,          -- behance, linkedin, instagram, dribbble, github, website, youtube, x, other
  label      text,
  url        text not null,
  sort_order int  not null default 0,
  visible    boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  TAGS
-- ---------------------------------------------------------------------
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  color      text not null default '#2f7bff',
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  PROJETOS
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  slug              text not null unique,
  short_description text,
  project_date      date,
  cover_url         text,
  accent_color      text,
  published         boolean not null default true,
  sort_order        int     not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.settings
  drop constraint if exists settings_featured_project_fk,
  add constraint settings_featured_project_fk
    foreign key (featured_project_id) references public.projects (id) on delete set null;

create table if not exists public.project_tags (
  project_id uuid not null references public.projects (id) on delete cascade,
  tag_id     uuid not null references public.tags (id)     on delete cascade,
  primary key (project_id, tag_id)
);

create table if not exists public.project_media (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  type       text not null default 'image' check (type in ('image', 'video', 'embed')),
  url        text not null,
  caption    text,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.project_links (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  platform   text not null,           -- behance, linkedin, instagram, website, dribbble, ...
  label      text,
  url        text not null,
  sort_order int  not null default 0
);

-- ---------------------------------------------------------------------
--  ESTUDOS / TRAJETÓRIA (formação, trabalho atual, cursos + certificado)
-- ---------------------------------------------------------------------
create table if not exists public.education (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'curso' check (kind in ('formacao', 'trabalho', 'curso')),
  title           text not null,         -- ex.: "Design Gráfico", "UI Designer", "UX Research"
  institution     text not null,         -- ex.: "FATEC", "Empresa X", "Alura"
  description     text,
  start_date      date,
  end_date        date,
  is_current      boolean not null default false,
  applied_text    text,                  -- "o que apliquei no curso" (aparece no modal do certificado)
  certificate_url text,                  -- PDF/imagem do certificado
  credential_url  text,                  -- link de validação
  logo_url        text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

-- Para quem já rodou uma versão anterior deste arquivo:
alter table public.education add column if not exists applied_text text;
-- logo personalizada para o tema escuro (logo_url = tema claro)
alter table public.settings add column if not exists logo_dark_url text;
-- offline: projeto que já foi publicado e saiu do ar (published = false).
-- Rascunho = published false e offline false.
alter table public.projects add column if not exists offline boolean not null default false;
-- colunas que nada usa: o destaque usa o título e o texto do próprio projeto,
-- e o projeto só tem a descrição curta
alter table public.settings drop column if exists hero_media_url;
alter table public.settings drop column if exists featured_title;
alter table public.settings drop column if exists featured_text;
alter table public.projects drop column if exists description;

-- Regras que o banco garante (além do painel). "not valid": valem para tudo o que
-- for salvo daqui em diante, sem travar a instalação se já houver dado antigo fora delas.
-- projeto offline é um projeto fora do ar: não pode estar publicado ao mesmo tempo
alter table public.projects drop constraint if exists projects_state_chk;
alter table public.projects add constraint projects_state_chk check (not (published and offline)) not valid;
-- cores sempre em hexadecimal (#rgb, #rrggbb ou com transparência)
alter table public.projects drop constraint if exists projects_color_chk;
alter table public.projects add constraint projects_color_chk check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{3,8}$') not valid;
alter table public.tags drop constraint if exists tags_color_chk;
alter table public.tags add constraint tags_color_chk check (color ~ '^#[0-9a-fA-F]{3,8}$') not valid;
alter table public.settings drop constraint if exists settings_colors_chk;
alter table public.settings add constraint settings_colors_chk check (
  color_accent ~ '^#[0-9a-fA-F]{3,8}$' and color_accent_2 ~ '^#[0-9a-fA-F]{3,8}$' and
  color_bg_light ~ '^#[0-9a-fA-F]{3,8}$' and color_fg_light ~ '^#[0-9a-fA-F]{3,8}$' and
  color_bg_dark ~ '^#[0-9a-fA-F]{3,8}$' and color_fg_dark ~ '^#[0-9a-fA-F]{3,8}$'
) not valid;
-- a conclusão não pode vir antes do início
alter table public.education drop constraint if exists education_dates_chk;
alter table public.education add constraint education_dates_chk check (end_date is null or start_date is null or end_date >= start_date) not valid;

-- ---------------------------------------------------------------------
--  ÍNDICES (FKs e ordenações usadas pelo site)
-- ---------------------------------------------------------------------
create index if not exists project_tags_tag_idx     on public.project_tags  (tag_id);
create index if not exists project_media_project_idx on public.project_media (project_id, sort_order);
create index if not exists project_links_project_idx on public.project_links (project_id, sort_order);
create index if not exists projects_published_idx    on public.projects (sort_order, project_date desc) where published;
create index if not exists education_kind_idx        on public.education (kind, sort_order);

-- ---------------------------------------------------------------------
--  TRIGGERS
-- ---------------------------------------------------------------------
drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists settings_updated_at on public.settings;
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

drop trigger if exists projects_slug on public.projects;
create trigger projects_slug before insert or update of title, slug on public.projects
  for each row execute function public.fill_slug();

drop trigger if exists tags_slug on public.tags;
create trigger tags_slug before insert or update of name, slug on public.tags
  for each row execute function public.fill_slug();

-- ---------------------------------------------------------------------
--  RLS — leitura pública, escrita só para admins
-- ---------------------------------------------------------------------
alter table public.admins        enable row level security;
alter table public.settings      enable row level security;
alter table public.social_links  enable row level security;
alter table public.tags          enable row level security;
alter table public.projects      enable row level security;
alter table public.project_tags  enable row level security;
alter table public.project_media enable row level security;
alter table public.project_links enable row level security;
alter table public.education     enable row level security;

-- admins: cada usuário só enxerga a própria linha (para o painel saber se é admin)
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

-- leitura pública
drop policy if exists "public read settings" on public.settings;
create policy "public read settings" on public.settings for select using (true);

drop policy if exists "public read social" on public.social_links;
create policy "public read social" on public.social_links for select using (visible or (select public.is_admin()));

drop policy if exists "public read tags" on public.tags;
create policy "public read tags" on public.tags for select using (true);

drop policy if exists "public read projects" on public.projects;
create policy "public read projects" on public.projects for select using (published or (select public.is_admin()));

drop policy if exists "public read project_tags" on public.project_tags;
create policy "public read project_tags" on public.project_tags for select using (
  exists (select 1 from public.projects p where p.id = project_id and (p.published or (select public.is_admin())))
);

drop policy if exists "public read project_media" on public.project_media;
create policy "public read project_media" on public.project_media for select using (
  exists (select 1 from public.projects p where p.id = project_id and (p.published or (select public.is_admin())))
);

drop policy if exists "public read project_links" on public.project_links;
create policy "public read project_links" on public.project_links for select using (
  exists (select 1 from public.projects p where p.id = project_id and (p.published or (select public.is_admin())))
);

drop policy if exists "public read education" on public.education;
create policy "public read education" on public.education for select using (true);

-- escrita: somente admins
do $$
declare t text;
begin
  foreach t in array array['settings','social_links','tags','projects','project_tags','project_media','project_links','education']
  loop
    execute format('drop policy if exists "admin insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admin update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admin delete %1$s" on public.%1$I', t);
    execute format('create policy "admin insert %1$s" on public.%1$I for insert to authenticated with check ((select public.is_admin()))', t);
    execute format('create policy "admin update %1$s" on public.%1$I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('create policy "admin delete %1$s" on public.%1$I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  get_portfolio() — o site público faz UMA requisição e recebe tudo.
--  security invoker: as policies acima continuam valendo (rascunhos ficam ocultos).
-- ---------------------------------------------------------------------
create or replace function public.get_portfolio()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) from public.settings s where s.id = 1),
    'socials', coalesce((
      select jsonb_agg(to_jsonb(sl) order by sl.sort_order)
      from public.social_links sl where sl.visible
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.sort_order, t.name) from public.tags t
    ), '[]'::jsonb),
    'education', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.sort_order, e.start_date desc nulls last) from public.education e
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
          'tag_ids', coalesce((select jsonb_agg(pt.tag_id) from public.project_tags pt where pt.project_id = p.id), '[]'::jsonb),
          'media',   coalesce((select jsonb_agg(to_jsonb(m) order by m.sort_order) from public.project_media m where m.project_id = p.id), '[]'::jsonb),
          'links',   coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order) from public.project_links l where l.project_id = p.id), '[]'::jsonb)
        )
        order by p.sort_order, p.project_date desc nulls last
      )
      from public.projects p where p.published
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_portfolio() to anon, authenticated;

-- ---------------------------------------------------------------------
--  save_project(payload) — o painel salva projeto + tags + mídias + links
--  em UMA transação. security invoker: as policies de admin são aplicadas.
-- ---------------------------------------------------------------------
create or replace function public.save_project(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pid uuid := nullif(payload ->> 'id', '')::uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'Somente administradores podem salvar projetos' using errcode = '42501';
  end if;

  if pid is null then
    insert into public.projects (title, slug, short_description, project_date, cover_url, accent_color, published, offline, sort_order)
    values (
      payload ->> 'title', coalesce(payload ->> 'slug', ''), payload ->> 'short_description',
      nullif(payload ->> 'project_date', '')::date, payload ->> 'cover_url', payload ->> 'accent_color',
      coalesce((payload ->> 'published')::boolean, true),
      coalesce((payload ->> 'offline')::boolean, false),
      coalesce((payload ->> 'sort_order')::int, (select coalesce(max(sort_order), 0) + 1 from public.projects))
    )
    returning id into pid;
  else
    update public.projects set
      title = payload ->> 'title',
      slug = coalesce(payload ->> 'slug', ''),
      short_description = payload ->> 'short_description',
      project_date = nullif(payload ->> 'project_date', '')::date,
      cover_url = payload ->> 'cover_url',
      accent_color = payload ->> 'accent_color',
      published = coalesce((payload ->> 'published')::boolean, published),
      offline = coalesce((payload ->> 'offline')::boolean, offline)
    where id = pid;
  end if;

  delete from public.project_tags  where project_id = pid;
  delete from public.project_media where project_id = pid;
  delete from public.project_links where project_id = pid;

  insert into public.project_tags (project_id, tag_id)
  select pid, t::uuid from jsonb_array_elements_text(coalesce(payload -> 'tag_ids', '[]')) t;

  insert into public.project_media (project_id, type, url, caption, sort_order)
  select pid, coalesce(m ->> 'type', 'image'), m ->> 'url', m ->> 'caption', (ord - 1)::int
  from jsonb_array_elements(coalesce(payload -> 'media', '[]')) with ordinality as x(m, ord)
  where coalesce(m ->> 'url', '') <> '';

  insert into public.project_links (project_id, platform, label, url, sort_order)
  select pid, coalesce(l ->> 'platform', 'website'), nullif(l ->> 'label', ''), l ->> 'url', (ord - 1)::int
  from jsonb_array_elements(coalesce(payload -> 'links', '[]')) with ordinality as x(l, ord)
  where coalesce(l ->> 'url', '') <> '';

  return pid;
end;
$$;

revoke execute on function public.save_project(jsonb) from anon, public;
grant execute on function public.save_project(jsonb) to authenticated;

-- ---------------------------------------------------------------------
--  STORAGE — bucket público "media" (imagens, vídeos, certificados)
-- ---------------------------------------------------------------------
-- Tamanho máximo de 50 MB e só imagens (sem SVG, que pode carregar script),
-- vídeos e PDF. O painel confere o mesmo antes de enviar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf'
])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media public read"  on storage.objects;
drop policy if exists "media admin insert" on storage.objects;
drop policy if exists "media admin update" on storage.objects;
drop policy if exists "media admin delete" on storage.objects;

-- Bucket público: os arquivos abrem pela URL pública sem precisar de policy.
-- Por isso não há leitura para anon (ela deixaria qualquer um LISTAR o bucket,
-- inclusive imagens de rascunhos). Só o admin lista/lê (necessário para apagar).
drop policy if exists "media admin read" on storage.objects;
create policy "media admin read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (select public.is_admin()));
create policy "media admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select public.is_admin()));
create policy "media admin update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select public.is_admin()))
  with check (bucket_id = 'media' and (select public.is_admin()));
create policy "media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select public.is_admin()));

-- ---------------------------------------------------------------------
--  DADOS INICIAIS
-- ---------------------------------------------------------------------
insert into public.settings (id, site_name, email, location, about_text, skills, studies_subtitle)
values (
  1,
  'Seu Nome',
  'contato@seudominio.com',
  'São Paulo, Brasil',
  'Sou designer focado em UX/UI e design gráfico. Transformo problemas complexos em interfaces simples, marcas memoráveis e experiências que as pessoas querem usar.',
  array['UX Research', 'UI Design', 'Design Systems', 'Branding', 'Motion', 'Figma', 'Illustrator', 'Photoshop'],
  'Onde estudei, onde trabalho e o que continuo aprendendo.'
)
on conflict (id) do nothing;

-- =====================================================================
--  DEPOIS DE CRIAR SEU USUÁRIO (Authentication > Users > Add user),
--  torne-o admin rodando (troque o e-mail):
--
--  insert into public.admins (user_id)
--  select id from auth.users where email = 'seu-email@exemplo.com';
-- =====================================================================
