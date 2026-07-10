alter table public.ai_suggestions drop constraint ai_suggestions_target_type_check;
alter table public.ai_suggestions add constraint ai_suggestions_target_type_check check (target_type in ('assessment_question', 'soa_item', 'audit', 'readiness_report'));
alter table public.ai_suggestions drop constraint ai_suggestions_suggestion_type_check;
alter table public.ai_suggestions add constraint ai_suggestions_suggestion_type_check check (suggestion_type in ('assessment_remediation', 'soa_rationale', 'audit_preparation', 'readiness_summary'));
