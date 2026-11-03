-- Vuelos en seguimiento (3-nov-2026). Aplicada con apply_migration en tres pasos
-- (vuelos_en_seguimiento, vuelos_hora_por_confirmar, toca_updated_at_search_path);
-- este archivo es la versión consolidada.
--
-- Antes la lista de clientes vigilados vivía solo en el SKILL.md de la tarea local
-- vigilancia-vuelos-clientes: agregar a alguien obligaba a editar ese archivo en la
-- Mac y el teléfono no la veía. Ahora la app la muestra y la edita (pestaña Vuelos)
-- y la tarea la lee de aquí y escribe cada vuelo que detecta en `vuelos`.

create table if not exists public.vuelos_vigilados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  nombre text not null,
  claves text,                       -- claves de contrato, separadas por coma
  tipo text not null default 'seguimiento' check (tipo in ('fijo','seguimiento')),
  hasta_fecha date,                  -- fin del seguimiento
  hasta_viajes int check (hasta_viajes is null or hasta_viajes > 0),
  recordatorios boolean not null default true,
  correos text,                      -- consulta de Gmail; si falta, se busca por claves
  desde timestamptz not null default now(),
  motivo text,
  contexto text,
  contacto text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vuelos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  vigilado_id uuid references public.vuelos_vigilados(id) on delete set null,
  cliente text not null,
  clave_contrato text,
  clave_reserva text,
  tramo text check (tramo in ('ida','regreso','unico')),
  sale_at timestamptz not null,
  -- Un preliminar a veces trae el día pero no la hora: se guarda el día y se marca.
  hora_por_confirmar boolean not null default false,
  origen text,
  destino text,
  equipo text,
  pasajeros int,
  estado text not null default 'programado' check (estado in ('programado','cambio','cancelado','volado')),
  nota text,
  liga text,
  msgid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cliente, sale_at, origen, destino)
);
create index if not exists vuelos_sale_at_idx on public.vuelos (user_id, sale_at);

alter table public.vuelos_vigilados enable row level security;
alter table public.vuelos enable row level security;

-- Como en feed: cada quien ve y edita lo suyo. Sin política de DELETE: un cliente se
-- desactiva (activo = false) y un vuelo se marca cancelado; nada se borra desde la app.
create policy vv_own_select on public.vuelos_vigilados for select using (user_id = auth.uid());
create policy vv_own_insert on public.vuelos_vigilados for insert with check (user_id = auth.uid());
create policy vv_own_update on public.vuelos_vigilados for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy vu_own_select on public.vuelos for select using (user_id = auth.uid());
create policy vu_own_insert on public.vuelos for insert with check (user_id = auth.uid());
create policy vu_own_update on public.vuelos for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.toca_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger vv_updated before update on public.vuelos_vigilados for each row execute function public.toca_updated_at();
create trigger vu_updated before update on public.vuelos for each row execute function public.toca_updated_at();
