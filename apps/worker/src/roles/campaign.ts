import { getCampaignStats, materializeRecipients, prisma, runCampaignBatch } from "@herald/db";
import { campaignProgress, campaignRecipients, logger } from "@herald/observability";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const runCampaignLoop = async (signal: AbortSignal): Promise<void> => {
  while (!signal.aborted) {
    try {
      const campaigns = await prisma.campaign.findMany({
        where: { status: "RUNNING" },
        select: { id: true, channel: true, rateLimit: true },
      });

      for (const campaign of campaigns) {
        if (signal.aborted) {
          break;
        }

        const recipients = await prisma.campaignRecipient.count({
          where: { campaignId: campaign.id },
        });

        if (recipients === 0) {
          const inserted = await materializeRecipients(prisma, campaign.id);
          logger.info({ campaign_id: campaign.id, recipients: inserted }, "campaign materialized");
        }

        const result = await runCampaignBatch(prisma, campaign.id);
        const stats = await getCampaignStats(prisma, campaign.id);
        campaignProgress.set(stats.progress_ratio);
        campaignRecipients.inc({ status: "queued", channel: campaign.channel.toLowerCase() }, result.emitted);

        if (result.processed > 0) {
          await sleep(Math.max(100, (result.processed / campaign.rateLimit) * 1000));
        }
      }
    } catch (error) {
      logger.error({ err: error }, "campaign loop failed");
    }

    await sleep(1000);
  }
};
