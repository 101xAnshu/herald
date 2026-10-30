import type { CampaignCreate, CampaignRecipientStatus } from "@herald/contracts";
import {
  campaignStatusFromDb,
  cancelCampaign,
  channelFromDb,
  createCampaign,
  getCampaign,
  getCampaignStats,
  launchCampaign,
  listCampaignRecipients,
  listCampaigns,
  pauseCampaign,
  prisma,
  recipientStatusFromDb,
  resumeCampaign,
} from "@herald/db";

const campaignView = (row: {
  id: string;
  name: string;
  templateId: string;
  channel: string;
  audience: unknown;
  payload: unknown;
  scheduledFor: Date | null;
  rateLimit: number;
  status: string;
  createdBy: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: row.id,
  name: row.name,
  template_id: row.templateId,
  channel: channelFromDb(row.channel as never),
  audience: row.audience,
  payload: row.payload,
  scheduled_for: row.scheduledFor?.toISOString() ?? null,
  rate_limit: row.rateLimit,
  status: campaignStatusFromDb(row.status as never),
  created_by: row.createdBy,
  started_at: row.startedAt?.toISOString() ?? null,
  completed_at: row.completedAt?.toISOString() ?? null,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

export const list = async () => (await listCampaigns(prisma)).map(campaignView);

export const detail = async (id: string) => {
  const campaign = await getCampaign(prisma, id);
  return campaignView(campaign);
};

export const create = async (input: CampaignCreate, actor: string) => {
  const campaign = await createCampaign(prisma, input, actor);
  return campaignView(campaign);
};

export const launch = async (id: string) => campaignView(await launchCampaign(prisma, id));
export const pause = async (id: string) => campaignView(await pauseCampaign(prisma, id));
export const resume = async (id: string) => campaignView(await resumeCampaign(prisma, id));
export const cancel = async (id: string) => campaignView(await cancelCampaign(prisma, id));
export const stats = (id: string) => getCampaignStats(prisma, id);

export const recipients = async (
  id: string,
  options: { limit: number; status?: CampaignRecipientStatus; cursor?: string },
) => {
  const page = await listCampaignRecipients(prisma, id, options);

  return {
    items: page.items.map((row) => ({
      campaign_id: row.campaignId,
      user_id: row.userId,
      shard: row.shard,
      status: recipientStatusFromDb(row.status),
      notification_id: row.notificationId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    })),
    meta: {
      next_cursor: page.hasMore ? page.items[page.items.length - 1]?.userId ?? null : null,
      has_more: page.hasMore,
    },
  };
};
