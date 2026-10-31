export { Prisma, type PrismaClient } from "./generated/prisma/client";
export {
  disconnectPrisma,
  getPrisma,
  getPrismaForUser,
  prisma,
  type Db,
} from "./prisma";
export { shardForUser } from "./shard";
export {
  campaignStatusFromDb,
  campaignStatusToDb,
  channelFromDb,
  channelToDb,
  deliveryStatusFromDb,
  deliveryStatusToDb,
  errorClassFromDb,
  errorClassToDb,
  eventTypeStatusFromDb,
  eventTypeStatusToDb,
  notificationStatusFromDb,
  notificationStatusToDb,
  priorityFromDb,
  priorityToDb,
  recipientStatusFromDb,
  recipientStatusToDb,
  sourceFromDb,
  sourceToDb,
  userKindFromDb,
  userStatusFromDb,
} from "./mappers";

export {
  authenticateApiKey,
  issueApiKey,
  revokeApiKey,
  rotateApiKey,
  type IssuedApiKey,
} from "./repositories/api-clients";
export {
  createEventType,
  createTemplate,
  createTemplateVersion,
  findTemplateForRecipient,
  getEventType,
  getTemplateWithVersion,
  listEventTypes,
  listTemplates,
  publishTemplateVersion,
  updateEventType,
} from "./repositories/catalog";
export {
  cancelNotification,
  deliveriesForNotification,
  deliveryToView,
  findNotification,
  getNotification,
  getNotificationTrace,
  listNotifications,
  notificationToView,
  retryNotification,
  type NotificationFilter,
} from "./repositories/notifications";
export {
  getInboxItem,
  getPreferences,
  listInbox,
  loadPolicyUser,
  markAllInboxRead,
  markInboxRead,
  recordUnsubscribe,
  resolveUser,
  resolveUserByExternalId,
  setQuietHours,
  updatePreferences,
} from "./repositories/users";

export {
  cancelCampaign,
  completeCampaign,
  createCampaign,
  failCampaign,
  getCampaign,
  getCampaignStats,
  launchCampaign,
  listCampaignRecipients,
  listCampaigns,
  materializeRecipients,
  pauseCampaign,
  resumeCampaign,
  runCampaignBatch,
  syncRecipientStatus,
  type CampaignRunResult,
} from "./use-cases/campaigns";
export { processDelivery, type DeliveryOutcome } from "./use-cases/delivery";
export { ingestEvent, type IngestInput, type IngestResult } from "./use-cases/ingest";
export {
  orchestrateNotification,
  type OrchestrateOptions,
  type OrchestrateResult,
} from "./use-cases/orchestrator";
export {
  discardDlq,
  getDlq,
  getOpsStats,
  listAudit,
  listDlq,
  listOutbox,
  listProviderFaults,
  listRetries,
  listSources,
  replayDlq,
  replicationStatus,
  setProviderFault,
  setSourcePaused,
} from "./use-cases/ops";
export {
  reconcileUnknownDeliveries,
  type ReconcileResult,
} from "./use-cases/reconciler";
export { relayOutbox, type RelayResult } from "./use-cases/relay";
export { runRetention, type RetentionResult } from "./use-cases/retention";
export {
  promoteSingleRetry,
  runSchedulerJobs,
  type SchedulerResult,
} from "./use-cases/scheduler";
