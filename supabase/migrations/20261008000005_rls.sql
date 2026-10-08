-- ============================================================================
-- 0005 ROW LEVEL SECURITY
-- The browser only ever holds the anon key + the user's JWT. Every table is
-- locked down here; privileged writes (worker, audit log, role changes) use
-- the service role on the server after explicit permission checks.
-- ============================================================================

alter table public.organisations enable row level security;
alter table public.teams enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.user_permissions enable row level security;
alter table public.invites enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;
alter table public.businesses enable row level security;
alter table public.business_field_sources enable row level security;
alter table public.business_socials enable row level security;
alter table public.websites enable row level security;
alter table public.website_audits enable row level security;
alter table public.lead_scores enable row level security;
alter table public.sales_intent enable row level security;
alter table public.opportunities enable row level security;
alter table public.outreach enable row level security;
alter table public.follow_ups enable row level security;
alter table public.notes enable row level security;
alter table public.tags enable row level security;
alter table public.lead_tags enable row level security;
alter table public.activities enable row level security;
alter table public.business_snapshots enable row level security;
alter table public.duplicate_candidates enable row level security;
alter table public.saved_filters enable row level security;
alter table public.providers enable row level security;
alter table public.searches enable row level security;
alter table public.search_jobs enable row level security;
alter table public.job_tasks enable row level security;
alter table public.source_records enable row level security;
alter table public.search_results enable row level security;
alter table public.search_coverage enable row level security;
alter table public.imports enable row level security;
alter table public.import_rows enable row level security;
alter table public.exports enable row level security;
alter table public.approval_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.org_settings enable row level security;

-- Reference data -------------------------------------------------------------
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

create policy organisations_read on public.organisations for select to authenticated
  using (id = public.current_org());
create policy organisations_update on public.organisations for update to authenticated
  using (id = public.current_org() and public.has_perm('admin.settings'))
  with check (id = public.current_org());

create policy teams_read on public.teams for select to authenticated using (organisation_id = public.current_org());
create policy teams_write on public.teams for all to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.users'))
  with check (organisation_id = public.current_org() and public.has_perm('admin.users'));

-- Profiles: everyone sees their own row (even while PENDING); active users see
-- colleagues; only self-updates of non-privileged fields (trigger-enforced).
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_org_read on public.profiles for select to authenticated using (organisation_id = public.current_org());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy user_permissions_read on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_perm('admin.users'));

create policy invites_admin on public.invites for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.users'));

-- Categories / locations: global defaults readable by all active users.
create policy categories_read on public.categories for select to authenticated
  using (public.is_active_user() and (organisation_id is null or organisation_id = public.current_org()));
create policy categories_write on public.categories for all to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.categories'))
  with check (organisation_id = public.current_org() and public.has_perm('admin.categories'));

create policy locations_read on public.locations for select to authenticated
  using (public.is_active_user() and (organisation_id is null or organisation_id = public.current_org()));
create policy locations_write on public.locations for all to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.locations'))
  with check (organisation_id = public.current_org() and public.has_perm('admin.locations'));

-- Businesses -----------------------------------------------------------------
create policy businesses_read on public.businesses for select to authenticated
  using (public.can_view_business(organisation_id, owner_id, team_id, lifecycle));
create policy businesses_insert on public.businesses for insert to authenticated
  with check (organisation_id = public.current_org() and (public.has_perm('leads.create') or public.has_perm('search.run')));
create policy businesses_update on public.businesses for update to authenticated
  using (public.can_view_business(organisation_id, owner_id, team_id, lifecycle)
         and (public.has_perm('leads.edit') or public.has_perm('research.review')))
  with check (organisation_id = public.current_org());
create policy businesses_delete on public.businesses for delete to authenticated
  using (organisation_id = public.current_org() and public.has_perm('leads.delete_permanent'));

-- Children of a business inherit its visibility.
create policy bfs_read on public.business_field_sources for select to authenticated using (public.can_view_business_id(business_id));
create policy socials_read on public.business_socials for select to authenticated using (public.can_view_business_id(business_id));
create policy socials_write on public.business_socials for all to authenticated
  using (public.can_edit_business_id(business_id)) with check (public.can_edit_business_id(business_id));
create policy websites_read on public.websites for select to authenticated using (public.can_view_business_id(business_id));
create policy website_audits_read on public.website_audits for select to authenticated using (public.can_view_business_id(business_id));
create policy lead_scores_read on public.lead_scores for select to authenticated using (public.can_view_business_id(business_id));
create policy sales_intent_read on public.sales_intent for select to authenticated using (public.can_view_business_id(business_id));
create policy opportunities_read on public.opportunities for select to authenticated using (public.can_view_business_id(business_id));
create policy opportunities_write on public.opportunities for all to authenticated
  using (public.can_edit_business_id(business_id) and public.has_perm('leads.override'))
  with check (public.can_edit_business_id(business_id) and public.has_perm('leads.override'));
create policy snapshots_read on public.business_snapshots for select to authenticated using (public.can_view_business_id(business_id));

create policy outreach_read on public.outreach for select to authenticated using (public.can_view_business_id(business_id));
create policy outreach_insert on public.outreach for insert to authenticated
  with check (public.can_view_business_id(business_id) and public.has_perm('outreach.log') and user_id = auth.uid());

create policy follow_ups_read on public.follow_ups for select to authenticated using (public.can_view_business_id(business_id));
create policy follow_ups_write on public.follow_ups for all to authenticated
  using (public.can_view_business_id(business_id) and public.has_perm('outreach.log'))
  with check (public.can_view_business_id(business_id) and public.has_perm('outreach.log'));

-- Private notes are visible to their author only.
create policy notes_read on public.notes for select to authenticated
  using (public.can_view_business_id(business_id) and (visibility = 'TEAM' or author_id = auth.uid()));
create policy notes_insert on public.notes for insert to authenticated
  with check (public.can_view_business_id(business_id) and public.has_perm('notes.create') and author_id = auth.uid());
create policy notes_update on public.notes for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy notes_delete on public.notes for delete to authenticated using (author_id = auth.uid());

create policy tags_read on public.tags for select to authenticated using (organisation_id = public.current_org());
create policy tags_write on public.tags for insert to authenticated
  with check (organisation_id = public.current_org() and public.has_perm('leads.edit'));
create policy lead_tags_read on public.lead_tags for select to authenticated using (public.can_view_business_id(business_id));
create policy lead_tags_write on public.lead_tags for all to authenticated
  using (public.can_edit_business_id(business_id)) with check (public.can_edit_business_id(business_id));

create policy activities_read on public.activities for select to authenticated
  using (organisation_id = public.current_org() and (business_id is null or public.can_view_business_id(business_id)));

create policy duplicates_read on public.duplicate_candidates for select to authenticated
  using (organisation_id = public.current_org() and public.can_view_business_id(business_a) and public.can_view_business_id(business_b));
create policy duplicates_update on public.duplicate_candidates for update to authenticated
  using (organisation_id = public.current_org() and public.has_perm('leads.merge'))
  with check (organisation_id = public.current_org());

create policy saved_filters_read on public.saved_filters for select to authenticated
  using (organisation_id = public.current_org() and (user_id = auth.uid() or is_shared));
create policy saved_filters_write on public.saved_filters for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and organisation_id = public.current_org());

-- Research --------------------------------------------------------------------
create policy providers_read on public.providers for select to authenticated
  using (organisation_id = public.current_org() and (public.has_perm('search.run') or public.has_perm('admin.providers')));
create policy providers_write on public.providers for update to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.providers'))
  with check (organisation_id = public.current_org());

create policy searches_read on public.searches for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('search.view'));
create policy searches_insert on public.searches for insert to authenticated
  with check (organisation_id = public.current_org() and public.has_perm('search.run') and created_by = auth.uid());
create policy searches_update on public.searches for update to authenticated
  using (organisation_id = public.current_org() and (created_by = auth.uid() or public.has_perm('search.manage_templates')))
  with check (organisation_id = public.current_org());

create policy search_jobs_read on public.search_jobs for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('search.view'));

create policy source_records_read on public.source_records for select to authenticated
  using (organisation_id = public.current_org() and (public.has_perm('research.review') or public.has_perm('admin.providers')));

create policy search_results_read on public.search_results for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('search.view'));
create policy search_results_update on public.search_results for update to authenticated
  using (organisation_id = public.current_org() and public.has_perm('research.review'))
  with check (organisation_id = public.current_org());

create policy coverage_read on public.search_coverage for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('search.view'));

-- job_tasks: no policies => no access for users. Service role only.

create policy imports_read on public.imports for select to authenticated
  using (organisation_id = public.current_org() and (created_by = auth.uid() or public.has_perm('admin.audit') or public.has_perm('imports.run')));
create policy import_rows_read on public.import_rows for select to authenticated
  using (exists (select 1 from public.imports i where i.id = import_id and i.organisation_id = public.current_org() and (i.created_by = auth.uid() or public.has_perm('imports.run'))));

create policy exports_read on public.exports for select to authenticated
  using (organisation_id = public.current_org() and (created_by = auth.uid() or public.has_perm('admin.audit')));

create policy approvals_read on public.approval_requests for select to authenticated
  using (organisation_id = public.current_org() and (requested_by = auth.uid() or public.has_perm('admin.approvals')));

create policy audit_logs_read on public.audit_logs for select to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.audit'));

create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy org_settings_read on public.org_settings for select to authenticated
  using (organisation_id = public.current_org());
create policy org_settings_write on public.org_settings for update to authenticated
  using (organisation_id = public.current_org() and public.has_perm('admin.scoring'))
  with check (organisation_id = public.current_org());

-- Function grants for authenticated users (RLS still applies inside invokers).
grant execute on function public.global_search(text, int) to authenticated;
grant execute on function public.dashboard_stats() to authenticated;
grant execute on function public.market_intelligence(text, text, text) to authenticated;
grant execute on function public.has_perm(text) to authenticated;
