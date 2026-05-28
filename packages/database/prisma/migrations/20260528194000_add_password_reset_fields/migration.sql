-- Add password reset fields to support forgot-password flow
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" TEXT,
ADD COLUMN IF NOT EXISTS "passwordResetSentAt" TIMESTAMP(3);
