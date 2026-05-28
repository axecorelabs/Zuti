-- Add SENT_TO_CHANNEL value to ActionDeliveryStatus enum
ALTER TYPE "ActionDeliveryStatus" ADD VALUE IF NOT EXISTS 'SENT_TO_CHANNEL' AFTER 'QUEUED';
