-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "payload" JSONB NOT NULL DEFAULT '{}';
