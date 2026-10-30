import type {
  CampaignRecipientStatus as ContractRecipientStatus,
  CampaignStatus as ContractCampaignStatus,
  Channel as ContractChannel,
  DeliveryStatus as ContractDeliveryStatus,
  ErrorClass as ContractErrorClass,
  EventTypeStatus as ContractEventTypeStatus,
  NotificationStatus as ContractNotificationStatus,
  OutboxStatus as ContractOutboxStatus,
  Priority as ContractPriority,
  RetryState as ContractRetryState,
  Scope as ContractScope,
  Source as ContractSource,
  UserKind as ContractUserKind,
  UserStatus as ContractUserStatus,
} from "@herald/contracts";
import type {
  CampaignRecipientStatus as DbRecipientStatus,
  CampaignStatus as DbCampaignStatus,
  Channel as DbChannel,
  DeliveryStatus as DbDeliveryStatus,
  ErrorClass as DbErrorClass,
  EventTypeStatus as DbEventTypeStatus,
  NotificationStatus as DbNotificationStatus,
  OutboxStatus as DbOutboxStatus,
  Priority as DbPriority,
  RetryState as DbRetryState,
  Source as DbSource,
  UserKind as DbUserKind,
  UserStatus as DbUserStatus,
} from "./generated/prisma/enums";

const toDb = <T extends string>(value: string): T => value.toUpperCase() as T;
const fromDb = <T extends string>(value: string): T => value.toLowerCase() as T;

export const sourceToDb = (value: ContractSource): DbSource => toDb<DbSource>(value);
export const sourceFromDb = (value: DbSource): ContractSource => fromDb<ContractSource>(value);

export const channelToDb = (value: ContractChannel): DbChannel => toDb<DbChannel>(value);
export const channelFromDb = (value: DbChannel): ContractChannel => fromDb<ContractChannel>(value);

export const priorityToDb = (value: ContractPriority): DbPriority => toDb<DbPriority>(value);
export const priorityFromDb = (value: DbPriority): ContractPriority => fromDb<ContractPriority>(value);

export const notificationStatusToDb = (value: ContractNotificationStatus): DbNotificationStatus =>
  toDb<DbNotificationStatus>(value);
export const notificationStatusFromDb = (value: DbNotificationStatus): ContractNotificationStatus =>
  fromDb<ContractNotificationStatus>(value);

export const deliveryStatusToDb = (value: ContractDeliveryStatus): DbDeliveryStatus =>
  toDb<DbDeliveryStatus>(value);
export const deliveryStatusFromDb = (value: DbDeliveryStatus): ContractDeliveryStatus =>
  fromDb<ContractDeliveryStatus>(value);

export const campaignStatusToDb = (value: ContractCampaignStatus): DbCampaignStatus =>
  toDb<DbCampaignStatus>(value);
export const campaignStatusFromDb = (value: DbCampaignStatus): ContractCampaignStatus =>
  fromDb<ContractCampaignStatus>(value);

export const recipientStatusToDb = (value: ContractRecipientStatus): DbRecipientStatus =>
  toDb<DbRecipientStatus>(value);
export const recipientStatusFromDb = (value: DbRecipientStatus): ContractRecipientStatus =>
  fromDb<ContractRecipientStatus>(value);

export const errorClassToDb = (value: ContractErrorClass): DbErrorClass => toDb<DbErrorClass>(value);
export const errorClassFromDb = (value: DbErrorClass): ContractErrorClass =>
  fromDb<ContractErrorClass>(value);

export const retryStateToDb = (value: ContractRetryState): DbRetryState => toDb<DbRetryState>(value);
export const retryStateFromDb = (value: DbRetryState): ContractRetryState =>
  fromDb<ContractRetryState>(value);

export const userKindToDb = (value: ContractUserKind): DbUserKind => toDb<DbUserKind>(value);
export const userKindFromDb = (value: DbUserKind): ContractUserKind => fromDb<ContractUserKind>(value);

export const userStatusToDb = (value: ContractUserStatus): DbUserStatus => toDb<DbUserStatus>(value);
export const userStatusFromDb = (value: DbUserStatus): ContractUserStatus =>
  fromDb<ContractUserStatus>(value);

export const eventTypeStatusToDb = (value: ContractEventTypeStatus): DbEventTypeStatus =>
  toDb<DbEventTypeStatus>(value);
export const eventTypeStatusFromDb = (value: DbEventTypeStatus): ContractEventTypeStatus =>
  fromDb<ContractEventTypeStatus>(value);

export const outboxStatusToDb = (value: ContractOutboxStatus): DbOutboxStatus =>
  toDb<DbOutboxStatus>(value);
export const outboxStatusFromDb = (value: DbOutboxStatus): ContractOutboxStatus =>
  fromDb<ContractOutboxStatus>(value);

export const scopesToDb = (values: readonly ContractScope[]): string[] => [...values];

export const scopesFromDb = (values: readonly string[]): ContractScope[] =>
  values as ContractScope[];
