ALTER TABLE "WorkspaceSetupRequest"
ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "WorkspaceSetupRequest_organizationId_idx"
ON "WorkspaceSetupRequest"("organizationId");

DO $$ BEGIN
  ALTER TABLE "WorkspaceSetupRequest"
  ADD CONSTRAINT "WorkspaceSetupRequest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
