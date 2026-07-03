begin;
select plan(8);

select is((select count(*) from public.frameworks where slug = 'iso-27001' and version = '2022'), 1::bigint, 'ISO 27001:2022 framework is seeded');
select is((select count(*) from public.requirements r join public.frameworks f on f.id = r.framework_id where f.slug = 'iso-27001'), 93::bigint, 'all 93 catalogue controls became requirements');
select is((select count(*) from public.controls), 93::bigint, 'shared control library is seeded 1:1');
select is((select count(*) from public.requirement_control_mappings), 93::bigint, 'every requirement maps to a control');
select is(
  (select count(*) from public.requirements r where not exists (select 1 from public.control_catalogue_controls c where c.id = r.id)),
  0::bigint, 'requirement ids reuse control catalogue ids'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select results_eq($$ select count(*) from public.controls $$, $$ values (93::bigint) $$, 'authenticated users can read the control library');
select throws_ok($$ insert into public.controls (code, title, position) values ('CH-999', 'Forged control', 999) $$, '42501', null, 'clients cannot write to the control library');
reset role;
select throws_ok($$ update public.frameworks set title = 'tampered' $$, 'P0001', 'framework catalogues are immutable', 'frameworks are immutable');

select * from finish();
rollback;
