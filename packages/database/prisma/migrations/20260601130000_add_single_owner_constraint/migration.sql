CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationMember_single_owner_per_org_idx"
ON "OrganizationMember" ("organizationId")
WHERE "role" = 'OWNER';