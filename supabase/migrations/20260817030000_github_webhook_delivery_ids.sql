alter table public.github_webhook_deliveries
drop constraint github_webhook_deliveries_provider_delivery_id_check;

alter table public.github_webhook_deliveries
add constraint github_webhook_deliveries_provider_delivery_id_check check (
  char_length(provider_delivery_id) between 1 and 100
  and provider_delivery_id ~ '^[!-~]+$'
);
