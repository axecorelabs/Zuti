-- Add a first-class action type for consultation/lead capture.
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'CONSULTATION_REQUEST';

-- Distinguish provider/API acceptance from human/team delivery confirmation.
ALTER TYPE "ActionDeliveryStatus" ADD VALUE IF NOT EXISTS 'SENT_TO_CHANNEL';
