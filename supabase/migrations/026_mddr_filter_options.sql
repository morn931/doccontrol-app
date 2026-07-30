-- 026: server-side DISTINCT for the document-search filter chips.
--
-- The meta endpoint built its filter lists by pulling rows and de-duping in JS,
-- but PostgREST caps the response (~1000 rows), so low-frequency values (e.g. a
-- new Sector "Contractual" with ~20 rows, or new vendors) were truncated out of
-- the sample and never showed as chips. This function computes the distinct sets
-- in Postgres and returns just the small arrays — cap-proof and fast.

create or replace function mddr_filter_options(
  p_awarded       text default 'true',
  p_package       text default null,
  p_exclude_index boolean default false
) returns json
language sql stable
as $$
  with base as (
    select * from mddr_entries
    where is_active
      and ( p_awarded = 'all'
            or (p_awarded = 'true'  and is_awarded)
            or (p_awarded = 'false' and not is_awarded) )
      and (not p_exclude_index or source_type <> 'INDEX')
  ),
  pkg as ( select * from base where p_package is null or package_code = p_package )
  select json_build_object(
    'packages',      (select coalesce(array_agg(distinct package_code    order by package_code)    filter (where package_code    is not null), '{}') from base),
    'sectors',       (select coalesce(array_agg(distinct sector          order by sector)          filter (where sector          is not null), '{}') from base),
    'vendors',       (select coalesce(array_agg(distinct vendor_name     order by vendor_name)     filter (where vendor_name     is not null), '{}') from pkg),
    'disciplines',   (select coalesce(array_agg(distinct discipline      order by discipline)      filter (where discipline      is not null), '{}') from pkg),
    'documentTypes', (select coalesce(array_agg(distinct document_type   order by document_type)   filter (where document_type   is not null), '{}') from pkg),
    'statuses',      (select coalesce(array_agg(distinct document_status order by document_status) filter (where document_status is not null), '{}') from pkg),
    'revisions',     (select coalesce(array_agg(distinct revision        order by revision)        filter (where revision        is not null), '{}') from pkg)
  );
$$;

grant execute on function mddr_filter_options(text, text, boolean) to anon, authenticated, service_role;
