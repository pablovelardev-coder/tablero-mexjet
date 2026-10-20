-- 19-oct-2026 — Historia de movimientos de tarjetas (`card_events`) y limpieza del feed.
--
-- Por qué: la pestaña Frentes no podía decir si un frente avanzaba, porque el
-- tablero solo guarda el estado actual. Ahora cada vez que una tarjeta entra al
-- tablero o cambia de columna, un trigger deja una fila aquí. La app la lee
-- (js/ui/instrumentos.js); nadie más que el trigger escribe.
--
-- Aplicada el 19-oct-2026 con apply_migration (`card_events_y_limpiar_feed` y
-- `revoca_rpc_boards_registra_movimientos`). Lo anterior al 19-oct se
-- reconstruyó a mano desde `boards_backup` con origen = 'respaldo': la fecha de
-- un alta reconstruida es la del primer respaldo donde aparece, o sea "al menos
-- desde", no la fecha real.

create table if not exists public.card_events (
  id        bigserial primary key,
  user_id   uuid not null references auth.users(id),
  kind      text not null,
  card_id   text not null,
  title     text,
  frente    text,
  from_col  text,                 -- null = la tarjeta entró al tablero
  to_col    text,                 -- null = la tarjeta salió del tablero
  at        timestamptz not null default now(),
  origen    text not null default 'trigger'
);
create index if not exists card_events_user_kind_at on public.card_events (user_id, kind, at desc);
create index if not exists card_events_card on public.card_events (user_id, kind, card_id, at desc);

-- Nace con RLS: el dueño lee lo suyo y nadie escribe desde la app.
alter table public.card_events enable row level security;
create policy card_events_lee_su_dueno on public.card_events
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.card_events from anon, authenticated;

create or replace function public.boards_registra_movimientos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.card_events (user_id, kind, card_id, title, frente, from_col, to_col)
  select new.user_id, new.kind, coalesce(n.id, o.id), coalesce(n.title, o.title), coalesce(n.frente, o.frente), o.col, n.col
  from (select c->>'id' id, c->>'title' title, c->>'frente' frente, c->>'col' col
        from jsonb_array_elements(coalesce(new.data->'cards','[]'::jsonb)) c) n
  full join (select c->>'id' id, c->>'title' title, c->>'frente' frente, c->>'col' col
             from jsonb_array_elements(case when tg_op = 'UPDATE' then coalesce(old.data->'cards','[]'::jsonb) else '[]'::jsonb end) c) o
    on o.id = n.id
  where coalesce(n.id, o.id) is not null
    and (o.col is distinct from n.col);
  return new;
end $function$;

-- Es función de trigger: no tiene por qué ser llamable por RPC (lo marcó get_advisors).
revoke all on function public.boards_registra_movimientos() from public, anon, authenticated;

create trigger boards_registra_movimientos_trg
  after insert or update of data on public.boards
  for each row execute function public.boards_registra_movimientos();

-- Limpieza del feed para la rutina de curación. Antes la rutina mandaba un
-- DELETE a mano y el conector se quedaba esperando una confirmación que en la
-- nube nadie da (timeout). Una función con nombre no pide confirmación.
-- Lo descartado no se borra nunca: es la memoria de lo que a Pablo no le interesa.
create or replace function public.limpiar_feed()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  delete from public.feed where created_at < now() - interval '30 days' and leido and not guardado and not descartado;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.limpiar_feed() from public, anon, authenticated;
