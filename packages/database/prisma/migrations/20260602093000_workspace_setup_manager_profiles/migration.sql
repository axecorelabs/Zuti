ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "canCreateWorkspace" BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  CREATE TYPE "ManagerVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WorkspaceSetupRequestStatus" AS ENUM ('PENDING', 'CONTACTED', 'COMPLETED', 'DECLINED', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ManagerProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "displayName" TEXT,
  "bio" TEXT,
  "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" "ManagerVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagerProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ManagerProfile_userId_key" ON "ManagerProfile"("userId");
CREATE INDEX IF NOT EXISTS "ManagerProfile_status_idx" ON "ManagerProfile"("status");

DO $$ BEGIN
  ALTER TABLE "ManagerProfile"
  ADD CONSTRAINT "ManagerProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "WorkspaceSetupRequest" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "managerId" TEXT NOT NULL,
  "status" "WorkspaceSetupRequestStatus" NOT NULL DEFAULT 'PENDING',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceSetupRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkspaceSetupRequest_requesterId_status_createdAt_idx"
ON "WorkspaceSetupRequest"("requesterId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "WorkspaceSetupRequest_managerId_status_createdAt_idx"
ON "WorkspaceSetupRequest"("managerId", "status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceSetupRequest_requesterId_managerId_status_key"
ON "WorkspaceSetupRequest"("requesterId", "managerId", "status");

DO $$ BEGIN
  ALTER TABLE "WorkspaceSetupRequest"
  ADD CONSTRAINT "WorkspaceSetupRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkspaceSetupRequest"
  ADD CONSTRAINT "WorkspaceSetupRequest_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
