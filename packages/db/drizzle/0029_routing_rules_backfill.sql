-- G3 — Backfill routing rules for ip / regulatory / litigation so the triage
-- handler can auto-assign matters in those practice areas. Before this,
-- matters in those areas logged `triage: no routing_rule for practice_area=...`
-- and were created with no assignee, forcing a manual reassign.
--
-- Defaults pick the closest-fit existing attorney from the seed so the rule
-- has a non-null assignee; the routing-rules admin lets the GC reassign
-- without a migration. SLA hours match the seeded rates for the closest
-- analogue area (Commercial=48 for IP, Privacy=24 for Regulatory,
-- Privacy=24 for Litigation).
--
-- WHERE NOT EXISTS keeps this idempotent and safe on environments where
-- an operator already created one of these rules manually via the admin.

INSERT INTO routing_rules (practice_area, default_assignee_id, sla_hours)
SELECT 'ip'::practice_area, u.id, 48
FROM users u
WHERE u.email = 'commercial@example.com'
  AND NOT EXISTS (SELECT 1 FROM routing_rules WHERE practice_area = 'ip');

INSERT INTO routing_rules (practice_area, default_assignee_id, sla_hours)
SELECT 'regulatory'::practice_area, u.id, 24
FROM users u
WHERE u.email = 'privacy@example.com'
  AND NOT EXISTS (SELECT 1 FROM routing_rules WHERE practice_area = 'regulatory');

INSERT INTO routing_rules (practice_area, default_assignee_id, sla_hours)
SELECT 'litigation'::practice_area, u.id, 24
FROM users u
WHERE u.email = 'gc@example.com'
  AND NOT EXISTS (SELECT 1 FROM routing_rules WHERE practice_area = 'litigation');
