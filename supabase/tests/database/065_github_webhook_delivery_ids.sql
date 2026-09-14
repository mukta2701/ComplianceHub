begin;

select plan(5);

set local role service_role;

select lives_ok(
  $$ insert into public.github_webhook_deliveries(
       provider_installation_id, provider_delivery_id, event_name, payload_sha256
     ) values (71, 'delivery:retry/v2!', 'repository', repeat('a', 64)) $$,
  'safe printable non-UUID provider delivery IDs are accepted'
);

select throws_ok(
  $$ insert into public.github_webhook_deliveries(
       provider_installation_id, provider_delivery_id, event_name, payload_sha256
     ) values (71, 'has space', 'repository', repeat('b', 64)) $$,
  '23514', null,
  'delivery IDs containing spaces are rejected'
);

select throws_ok(
  $$ insert into public.github_webhook_deliveries(
       provider_installation_id, provider_delivery_id, event_name, payload_sha256
     ) values (71, E'has\ttab', 'repository', repeat('c', 64)) $$,
  '23514', null,
  'delivery IDs containing controls are rejected'
);

select throws_ok(
  $$ insert into public.github_webhook_deliveries(
       provider_installation_id, provider_delivery_id, event_name, payload_sha256
     ) values (71, 'café', 'repository', repeat('d', 64)) $$,
  '23514', null,
  'delivery IDs containing non-ASCII text are rejected'
);

select throws_ok(
  $$ insert into public.github_webhook_deliveries(
       provider_installation_id, provider_delivery_id, event_name, payload_sha256
     ) values (71, repeat('x', 101), 'repository', repeat('e', 64)) $$,
  '23514', null,
  'delivery IDs longer than 100 characters are rejected'
);

select * from finish();
rollback;
