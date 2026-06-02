DO $$ BEGIN
  ALTER TYPE "WorkspaceSetupRequestStatus" ADD VALUE 'ORG_CREATED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "WorkspaceSetupRequestStatus" ADD VALUE 'REQUESTER_ADDED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
