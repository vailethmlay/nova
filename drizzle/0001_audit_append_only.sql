-- The audit log is append-only: any UPDATE, DELETE or TRUNCATE is rejected.
-- In production, also run the app as a role with only INSERT/SELECT on audit_log (see README).
CREATE OR REPLACE FUNCTION nova_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION nova_audit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION nova_audit_log_immutable();
