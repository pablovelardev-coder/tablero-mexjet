-- ============================================================================
-- Prueba de supabase/migrations/20261008_boards_rechaza_perdida_parcial.sql
-- ============================================================================
-- ⛔ NUNCA contra producción. Corre contra un Postgres local desechable:
--
--   psql -h <host> -p <puerto> -U postgres -v ON_ERROR_STOP=1 \
--        -f supabase/tests/boards_rechaza_perdida_parcial.test.sql
--
-- Arma una tabla `boards` mínima, carga el trigger de vaciado que ya existe en
-- producción (copiado tal cual el 8-oct-2026), aplica la migración nueva y
-- corre cada caso. Datos sintéticos: aquí no hay ningún dato de negocio.
-- Si un caso no da lo esperado, el script se detiene con "FALLA:".
-- ============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop table if exists public.boards cascade;
create table public.boards (
  user_id    uuid not null,
  kind       text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique (user_id, kind)
);

-- --- El trigger que ya existe en producción (definición del 31-ago-2026) ----
create or replace function public.boards_rechaza_vaciado()
returns trigger language plpgsql as $function$
declare
  antes int;
  despues int;
begin
  antes := coalesce(jsonb_array_length(OLD.data->'cards'), 0)
         + coalesce(jsonb_array_length(OLD.data->'tasks'), 0)
         + coalesce(jsonb_array_length(OLD.data->'rems'),  0);
  despues := coalesce(jsonb_array_length(NEW.data->'cards'), 0)
           + coalesce(jsonb_array_length(NEW.data->'tasks'), 0)
           + coalesce(jsonb_array_length(NEW.data->'rems'),  0);
  if antes > 0 and despues = 0 then
    raise exception
      'Escritura rechazada: dejaria el tablero "%" vacio (tenia % elementos). Si es intencional, quita el trigger boards_rechaza_vaciado_trg.',
      NEW.kind, antes
      using errcode = 'check_violation';
  end if;
  return NEW;
end;
$function$;
create trigger boards_rechaza_vaciado_trg
  before update on public.boards
  for each row execute function public.boards_rechaza_vaciado();

-- --- La migración nueva -----------------------------------------------------
\ir ../migrations/20261008_boards_rechaza_perdida_parcial.sql

-- --- Estado sembrado --------------------------------------------------------
-- 'direccion': 6 tarjetas · 10 pendientes (+1 sin id) · 4 recordatorios sueltos
--              · 3 recordatorios de la tarjeta c1 · 2 de la tarjeta c2
-- 'personal' : tablero chico, 2 elementos (para probar el de vaciado)
create or replace function pg_temp.semilla() returns jsonb language sql as $$
  select jsonb_build_object(
    'cards', (select jsonb_agg(jsonb_build_object('id', 'c'||i, 'title', 'Tarjeta '||i, 'col', 'nuevo'))
                from generate_series(1, 6) i),
    'tasks', (select jsonb_agg(jsonb_build_object('id', 't'||i, 'text', 'Pendiente '||i, 'status', 'Por hacer', 'due', '2026-10-20'))
                from generate_series(1, 10) i)
             || '[{"text": "pendiente viejo sin id", "status": "Por hacer"}]'::jsonb,
    'rems',  (select jsonb_agg(jsonb_build_object('id', 's'||i, 'text', 'Suelto '||i, 'date', '2026-10-20'))
                from generate_series(1, 4) i)
             || '[{"id":"r_c1a","text":"a","cardId":"c1"},{"id":"r_c1b","text":"b","cardId":"c1"},
                  {"id":"r_c1c","text":"c","cardId":"c1"},
                  {"id":"r_c2a","text":"a","cardId":"c2"},{"id":"r_c2b","text":"b","cardId":"c2"}]'::jsonb,
    'frentes', '[]'::jsonb)
$$;

insert into public.boards (user_id, kind, data) values
  ('00000000-0000-0000-0000-000000000001', 'direccion', pg_temp.semilla()),
  ('00000000-0000-0000-0000-000000000001', 'personal',
   '{"cards":[{"id":"p1","title":"x"}],"tasks":[{"id":"pt1","text":"y"}],"rems":[]}');

-- Regresa los dos tableros a la semilla. Usa la válvula porque el caso anterior
-- pudo haber AGREGADO elementos, y quitarlos también cuenta como pérdida.
create or replace function pg_temp.reiniciar() returns void language plpgsql as $$
begin
  perform set_config('boards.permite_perdida', 'on', true);
  update public.boards set data = pg_temp.semilla() where kind = 'direccion';
  update public.boards set data = '{"cards":[{"id":"p1","title":"x"}],"tasks":[{"id":"pt1","text":"y"}],"rems":[]}'
   where kind = 'personal';
  perform set_config('boards.permite_perdida', 'off', true);
end $$;

-- Corre un caso. `debe_pasar` dice lo que se espera; `valvula` abre la válvula
-- antes de la sentencia, como lo haría un `set local` en la misma transacción.
create or replace function pg_temp.caso(nombre text, sentencia text, debe_pasar boolean, valvula boolean default false)
returns void language plpgsql as $$
begin
  perform pg_temp.reiniciar();
  perform set_config('boards.permite_perdida', case when valvula then 'on' else 'off' end, true);
  begin
    execute sentencia;
    if not debe_pasar then
      raise exception 'FALLA: "%" debía RECHAZARSE y pasó', nombre;
    end if;
    raise notice 'ok   pasa      · %', nombre;
  exception when check_violation then
    if debe_pasar then
      raise exception 'FALLA: "%" debía PASAR y se rechazó: %', nombre, sqlerrm;
    end if;
    raise notice 'ok   rechaza   · % → %', nombre, left(sqlerrm, 110);
  end;
  perform set_config('boards.permite_perdida', 'off', true);
end $$;

-- ============================================================================
-- Lo que hace Claude todos los días por SQL — tiene que seguir pasando
-- ============================================================================
select pg_temp.caso('Claude: agrega un pendiente (append con guarda)', $q$
  update boards set data = jsonb_set(data, '{tasks}', (data->'tasks') ||
    '[{"id":"t_nuevo","text":"nuevo","status":"Por hacer"}]'::jsonb)
  where kind='direccion' and not exists (
    select 1 from jsonb_array_elements(data->'tasks') x where x->>'id'='t_nuevo')
$q$, true);

select pg_temp.caso('Claude: marca Hecha y cambia vencimientos (map con jsonb_agg)', $q$
  update boards set data = jsonb_set(data, '{tasks}', (select jsonb_agg(
    case when t->>'id' = 't1' then jsonb_set(t, '{status}', '"Hecha"')
         when t->>'id' in ('t2','t3') then jsonb_set(t, '{due}', '"2026-10-12"')
         else t end) from jsonb_array_elements(data->'tasks') t))
  where kind='direccion'
$q$, true);

select pg_temp.caso('Claude: solo toca updated_at', $q$
  update boards set updated_at = now() where kind='direccion'
$q$, true);

-- ============================================================================
-- Lo que hace la app al borrar — tiene que seguir pasando
-- ============================================================================
select pg_temp.caso('App: borra 1 pendiente (tasks.js)', $q$
  update boards set data = jsonb_set(data, '{tasks}', (select jsonb_agg(t)
    from jsonb_array_elements(data->'tasks') t where t->>'id' is distinct from 't4'))
  where kind='direccion'
$q$, true);

select pg_temp.caso('App: borra 1 recordatorio suelto (rems.js)', $q$
  update boards set data = jsonb_set(data, '{rems}', (select jsonb_agg(r)
    from jsonb_array_elements(data->'rems') r where r->>'id' is distinct from 's1'))
  where kind='direccion'
$q$, true);

select pg_temp.caso('App: borra la tarjeta c1 y sus 3 recordatorios (card-dialog.js) = 1 acción', $q$
  update boards set data = data
    || jsonb_build_object('cards', (select jsonb_agg(c) from jsonb_array_elements(data->'cards') c
                                     where c->>'id' <> 'c1'))
    || jsonb_build_object('rems',  (select jsonb_agg(r) from jsonb_array_elements(data->'rems') r
                                     where r->>'cardId' is distinct from 'c1'))
  where kind='direccion'
$q$, true);

select pg_temp.caso('App: edita c2 quitándole sus 2 recordatorios = 1 acción', $q$
  update boards set data = jsonb_set(data, '{rems}', (select jsonb_agg(r)
    from jsonb_array_elements(data->'rems') r where r->>'cardId' is distinct from 'c2'))
  where kind='direccion'
$q$, true);

select pg_temp.caso('App: 3 borrados que el debounce juntó en un guardado', $q$
  update boards set data = jsonb_set(data, '{tasks}', (select jsonb_agg(t)
    from jsonb_array_elements(data->'tasks') t
    where t->>'id' is null or t->>'id' not in ('t5','t6','t7')))
  where kind='direccion'
$q$, true);

select pg_temp.caso('App: quita el pendiente sin id + 3 con id = 3 (el sin id no cuenta)', $q$
  update boards set data = jsonb_set(data, '{tasks}', (select jsonb_agg(t)
    from jsonb_array_elements(data->'tasks') t
    where t->>'id' is not null and t->>'id' not in ('t5','t6','t7')))
  where kind='direccion'
$q$, true);

-- ============================================================================
-- Lo que tiene que RECHAZAR
-- ============================================================================
select pg_temp.caso('4 pendientes de un golpe', $q$
  update boards set data = jsonb_set(data, '{tasks}', (select jsonb_agg(t)
    from jsonb_array_elements(data->'tasks') t
    where t->>'id' is null or t->>'id' not in ('t5','t6','t7','t8')))
  where kind='direccion'
$q$, false);

select pg_temp.caso('Pestaña vieja: reescribe tasks con una copia que no tiene 5 pendientes', $q$
  update boards set data = jsonb_set(data, '{tasks}', (select jsonb_agg(t)
    from jsonb_array_elements(data->'tasks') t where t->>'id' in ('t1','t2','t3','t4','t5')))
  where kind='direccion'
$q$, false);

select pg_temp.caso('Pestaña vieja que además trae un pendiente sin id: el sin id no "salva" a nadie', $q$
  update boards set data = jsonb_set(data, '{tasks}', (select jsonb_agg(t)
    from jsonb_array_elements(data->'tasks') t where t->>'id' in ('t1','t2','t3','t4','t5'))
    || '[{"text":"otro sin id"}]'::jsonb)
  where kind='direccion'
$q$, false);

select pg_temp.caso('Mezcla: tarjeta c1 (con sus recordatorios) + 3 pendientes = 4', $q$
  update boards set data = data
    || jsonb_build_object('cards', (select jsonb_agg(c) from jsonb_array_elements(data->'cards') c
                                     where c->>'id' <> 'c1'))
    || jsonb_build_object('rems',  (select jsonb_agg(r) from jsonb_array_elements(data->'rems') r
                                     where r->>'cardId' is distinct from 'c1'))
    || jsonb_build_object('tasks', (select jsonb_agg(t) from jsonb_array_elements(data->'tasks') t
                                     where t->>'id' is null or t->>'id' not in ('t1','t2','t3')))
  where kind='direccion'
$q$, false);

select pg_temp.caso('Recordatorios de 2 tarjetas distintas + 2 pendientes = 4', $q$
  update boards set data = data
    || jsonb_build_object('rems',  (select jsonb_agg(r) from jsonb_array_elements(data->'rems') r
                                     where r->>'cardId' is null))
    || jsonb_build_object('tasks', (select jsonb_agg(t) from jsonb_array_elements(data->'tasks') t
                                     where t->>'id' is null or t->>'id' not in ('t1','t2')))
  where kind='direccion'
$q$, false);

select pg_temp.caso('Upsert de la app (on conflict) que pierde 5 pendientes', $q$
  insert into boards (user_id, kind, data)
  select user_id, kind, jsonb_set(data, '{tasks}', (select jsonb_agg(t)
    from jsonb_array_elements(data->'tasks') t where t->>'id' in ('t1','t2','t3','t4','t5')))
  from boards where kind='direccion'
  on conflict (user_id, kind) do update set data = excluded.data
$q$, false);

select pg_temp.caso('Vaciado total del tablero grande (lo atrapa éste antes que el de vaciado)', $q$
  update boards set data = '{"cards":[],"tasks":[],"rems":[]}' where kind='direccion'
$q$, false);

select pg_temp.caso('Tablero chico (2 elementos) vaciado: pasa éste, lo atrapa el de vaciado', $q$
  update boards set data = '{"cards":[],"tasks":[],"rems":[]}' where kind='personal'
$q$, false);

select pg_temp.caso('Borrar la FILA de un tablero con contenido', $q$
  delete from boards where kind='direccion'
$q$, false);

-- ============================================================================
-- La válvula
-- ============================================================================
select pg_temp.caso('Válvula: la misma pestaña vieja, con permite_perdida = on', $q$
  update boards set data = jsonb_set(data, '{tasks}', (select jsonb_agg(t)
    from jsonb_array_elements(data->'tasks') t where t->>'id' in ('t1','t2','t3','t4','t5')))
  where kind='direccion'
$q$, true, true);

select pg_temp.caso('Válvula: borrar la fila con contenido, con permite_perdida = on', $q$
  delete from boards where kind='personal'
$q$, true, true);

-- Una fila vacía se puede borrar sin válvula (no se pierde nada)
insert into public.boards (user_id, kind, data)
  values ('00000000-0000-0000-0000-000000000002', 'vacio', '{"cards":[],"tasks":[],"rems":[]}');
select pg_temp.caso('Borrar una fila que ya está vacía', $q$
  delete from boards where kind='vacio'
$q$, true);

\echo
\echo '✅ Todos los casos dieron lo esperado.'
