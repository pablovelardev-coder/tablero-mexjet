-- ============================================================================
-- boards: rechazar la pérdida parcial y el borrado de filas con contenido
-- ============================================================================
--
-- Contexto. `boards_rechaza_vaciado_trg` (31-ago-2026) rechaza que un tablero
-- quede en CERO elementos. No atrapa la pérdida PARCIAL: un `data` que regresa
-- con menos tarjetas, pendientes o recordatorios de los que tenía. Ése es el
-- daño que deja un cliente con estado viejo que hace `upsert` (una pestaña que
-- se quedó atrás y no vio lo que se agregó por SQL), o un `jsonb_set` mal
-- escrito a mano. A `boards` le escriben cuatro cosas —la app, la rutina de
-- info@ale.mx, y Claude desde la Mac y desde la nube— y sólo la base las ve a
-- todas. Por eso esto va aquí y no en un cliente.
--
-- Qué se cuenta. Se comparan los `id` de antes y de después y se cuentan las
-- ACCIONES de pérdida, no los elementos, para no estorbarle a la app:
--
--   * cada tarjeta perdida                         = 1 acción
--   * cada pendiente perdido                       = 1 acción
--   * cada recordatorio suelto perdido (sin cardId) = 1 acción
--   * los recordatorios perdidos de UNA tarjeta    = 1 acción en total
--   * los recordatorios de una tarjeta que también se borró = 0
--
-- Así, lo que la app hace al borrar una tarjeta (la tarjeta y todos sus
-- recordatorios, card-dialog.js) cuenta 1, y editar una tarjeta quitándole
-- recordatorios cuenta 1. Al editar, los recordatorios conservan su `id`
-- (`id: r.id || uid()`), así que una edición normal cuenta 0.
--
-- Umbral: más de 3 acciones en una sola escritura se rechaza. Deja pasar
-- varios borrados rápidos que el debounce de 400 ms junte en un solo guardado.
-- Calibración (8-oct-2026, contra boards_backup de las 07:11): 0 elementos
-- perdidos y 1 nuevo en el día. La pérdida legítima es muy baja.
--
-- Los elementos sin `id` no se cuentan (al 8-oct no hay ninguno, y sin `id`
-- no se puede saber si "desaparecieron" o sólo cambiaron).
--
-- Válvula. Un borrado grande e intencional se hace en una transacción con:
--     set local boards.permite_perdida = 'on';
-- La app no puede hacerlo (PostgREST no corre SET): sólo el conector de
-- administrador. Es a propósito.
--
-- Orden. Los BEFORE triggers corren por orden alfabético de nombre:
-- `..._perdida_parcial_trg` antes que `..._vaciado_trg`. Se complementan: un
-- tablero chico (3 elementos o menos) que se vacía pasa éste y lo rechaza el
-- de vaciado.
-- ============================================================================

create or replace function public.boards_rechaza_perdida_parcial()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  limite         constant int := 3;
  cards_perdidas text[];
  tasks_perdidas int;
  rems_sueltos   int;
  grupos_rems    int;
  acciones       int;
begin
  if coalesce(current_setting('boards.permite_perdida', true), '') = 'on' then
    return NEW;
  end if;

  select coalesce(array_agg(o->>'id'), '{}')
    into cards_perdidas
    from jsonb_array_elements(coalesce(OLD.data->'cards', '[]'::jsonb)) o
   where nullif(o->>'id', '') is not null
     and not exists (
           select 1 from jsonb_array_elements(coalesce(NEW.data->'cards', '[]'::jsonb)) n
            where n->>'id' = o->>'id');

  select count(*)
    into tasks_perdidas
    from jsonb_array_elements(coalesce(OLD.data->'tasks', '[]'::jsonb)) o
   where nullif(o->>'id', '') is not null
     and not exists (
           select 1 from jsonb_array_elements(coalesce(NEW.data->'tasks', '[]'::jsonb)) n
            where n->>'id' = o->>'id');

  select count(*) filter (where nullif(o->>'cardId', '') is null),
         count(distinct o->>'cardId') filter (
           where nullif(o->>'cardId', '') is not null
             and not (o->>'cardId' = any (cards_perdidas)))
    into rems_sueltos, grupos_rems
    from jsonb_array_elements(coalesce(OLD.data->'rems', '[]'::jsonb)) o
   where nullif(o->>'id', '') is not null
     and not exists (
           select 1 from jsonb_array_elements(coalesce(NEW.data->'rems', '[]'::jsonb)) n
            where n->>'id' = o->>'id');

  acciones := cardinality(cards_perdidas) + tasks_perdidas + rems_sueltos + grupos_rems;

  if acciones > limite then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'Escritura rechazada en el tablero "%s": perdería %s elementos de un golpe '
        '(%s tarjetas, %s pendientes, %s recordatorios sueltos, %s grupos de '
        'recordatorios de tarjeta). El límite es %s por escritura.',
        NEW.kind, acciones, cardinality(cards_perdidas), tasks_perdidas,
        rems_sueltos, grupos_rems, limite),
      hint = 'Si el borrado es intencional, en la misma transacción: '
             'set local boards.permite_perdida = ''on'';';
  end if;

  return NEW;
end;
$function$;

drop trigger if exists boards_rechaza_perdida_parcial_trg on public.boards;
create trigger boards_rechaza_perdida_parcial_trg
  before update on public.boards
  for each row execute function public.boards_rechaza_perdida_parcial();


-- ----------------------------------------------------------------------------
-- Borrar la FILA entera de un tablero con contenido es la pérdida total, y hoy
-- nada la detiene: el trigger de vaciado sólo mira UPDATE. La app nunca borra
-- filas; esto cubre un `delete from boards` del conector de administrador.
-- Misma válvula.
-- ----------------------------------------------------------------------------

create or replace function public.boards_rechaza_borrado_fila()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  elementos int;
begin
  if coalesce(current_setting('boards.permite_perdida', true), '') = 'on' then
    return OLD;
  end if;

  elementos := coalesce(jsonb_array_length(OLD.data->'cards'), 0)
             + coalesce(jsonb_array_length(OLD.data->'tasks'), 0)
             + coalesce(jsonb_array_length(OLD.data->'rems'),  0);

  if elementos > 0 then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'Borrado rechazado: la fila del tablero "%s" tiene %s elementos.',
        OLD.kind, elementos),
      hint = 'Si es intencional, en la misma transacción: '
             'set local boards.permite_perdida = ''on'';';
  end if;

  return OLD;
end;
$function$;

drop trigger if exists boards_rechaza_borrado_fila_trg on public.boards;
create trigger boards_rechaza_borrado_fila_trg
  before delete on public.boards
  for each row execute function public.boards_rechaza_borrado_fila();
