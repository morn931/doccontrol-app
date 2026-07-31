-- 027_aconex_issue_asbuilt.sql
-- As-Built documents flow through the Aconex issue queue too.
alter table aconex_issue drop constraint if exists aconex_issue_source_check;
alter table aconex_issue add constraint aconex_issue_source_check
  check (source in ('vendor','internal','redline','asbuilt'));
