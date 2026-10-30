import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EVENT_CATALOG,
  type Channel,
  type Scope,
  type Source,
} from "@herald/contracts";
import { hashAddress, hashToken, newId, userIdFromExternalId } from "@herald/core";
import { loadConfig } from "@herald/config";

import { getPrisma } from "../src/prisma";

const config = loadConfig();
const db = getPrisma(0);

const CHANNELS: Channel[] = ["email", "in_app", "push"];

const EVENT_SCHEMAS: Record<string, Record<string, unknown>> = {
  "booking.confirmed": {
    type: "object",
    required: ["booking_id", "service", "scheduled_for"],
    properties: {
      booking_id: { type: "string" },
      service: { type: "string" },
      pro_name: { type: "string" },
      scheduled_for: { type: "string" },
      address_label: { type: "string" },
    },
  },
  "booking.canceled": {
    type: "object",
    required: ["booking_id", "service", "scheduled_for"],
    properties: { booking_id: { type: "string" }, service: { type: "string" }, scheduled_for: { type: "string" } },
  },
  "payment.failed": {
    type: "object",
    required: ["payment_id", "amount", "currency"],
    properties: {
      payment_id: { type: "string" },
      amount: { type: "number" },
      currency: { type: "string" },
      retry_url: { type: "string" },
    },
  },
  "security.alert": {
    type: "object",
    required: ["alert"],
    properties: { alert: { type: "string" }, device: { type: "string" }, location: { type: "string" } },
  },
  "campaign.message": {
    type: "object",
    required: ["campaign_id"],
    properties: { campaign_id: { type: "string" }, offer: { type: "string" } },
  },
};
const SCOPES_BY_SOURCE: Record<Source, Scope[]> = {
  booking: ["events:write", "events:read"],
  payments: ["events:write", "events:read"],
  security: ["events:write", "events:read"],
  growth: ["events:write", "events:read", "campaigns:read", "campaigns:write"],
  ops: [
    "events:write",
    "events:read",
    "notifications:manage",
    "campaigns:read",
    "campaigns:write",
    "ops:read",
    "ops:manage",
    "catalog:write",
    "keys:manage",
  ],
};

const FIRST_NAMES = [
  "Aarav", "Aditi", "Ananya", "Arjun", "Diya", "Ishaan", "Kavya", "Kiran",
  "Meera", "Nikhil", "Pooja", "Rahul", "Ravi", "Riya", "Rohan", "Saanvi",
  "Siddharth", "Sneha", "Tanvi", "Vikram",
];

const LAST_NAMES = [
  "Deshmukh", "Iyer", "Joshi", "Kulkarni", "Mehta", "Nair", "Patel", "Rao",
  "Sharma", "Shetty", "Singh", "Verma",
];

const SERVICES = ["plumbing", "cleaning", "electrical", "carpentry", "painting"];
const CITIES = ["Pune", "Mumbai", "Bengaluru"];

const templateContent = {
  booking_confirmation: {
    email: {
      subject: "Your {{service}} booking is confirmed",
      text: "Hi {{display_name}}, your {{service}} booking {{booking_id}} with {{pro_name}} is confirmed for {{scheduled_for}} at {{address_label}}.",
      html: "<p>Hi {{display_name}},</p><p>Your <strong>{{service}}</strong> booking <code>{{booking_id}}</code> with {{pro_name}} is confirmed for {{scheduled_for}} at {{address_label}}.</p>",
    },
    in_app: {
      subject: "Booking confirmed",
      text: "{{service}} with {{pro_name}} on {{scheduled_for}}.",
      html: "<p>{{service}} with <strong>{{pro_name}}</strong> on {{scheduled_for}}.</p>",
    },
    push: {
      subject: "Booking confirmed",
      text: "{{service}} with {{pro_name}} on {{scheduled_for}}.",
      html: "<p>{{service}} with {{pro_name}} on {{scheduled_for}}.</p>",
    },
  },
  booking_cancellation: {
    email: {
      subject: "Your {{service}} booking was canceled",
      text: "Hi {{display_name}}, booking {{booking_id}} for {{scheduled_for}} has been canceled.",
      html: "<p>Hi {{display_name}},</p><p>Booking <code>{{booking_id}}</code> for {{scheduled_for}} has been canceled.</p>",
    },
    in_app: {
      subject: "Booking canceled",
      text: "Booking {{booking_id}} for {{scheduled_for}} was canceled.",
      html: "<p>Booking {{booking_id}} for {{scheduled_for}} was canceled.</p>",
    },
    push: {
      subject: "Booking canceled",
      text: "Booking {{booking_id}} for {{scheduled_for}} was canceled.",
      html: "<p>Booking {{booking_id}} for {{scheduled_for}} was canceled.</p>",
    },
  },
  payment_failure: {
    email: {
      subject: "Payment failed for your booking",
      text: "Hi {{display_name}}, we could not charge {{currency}} {{amount}}. Retry here: {{retry_url}}",
      html: "<p>Hi {{display_name}},</p><p>We could not charge <strong>{{currency}} {{amount}}</strong>.</p><p><a href=\"{{retry_url}}\">Retry the payment</a></p>",
    },
    in_app: {
      subject: "Payment failed",
      text: "We could not charge {{currency}} {{amount}}. Retry: {{retry_url}}",
      html: "<p>We could not charge {{currency}} {{amount}}. <a href=\"{{retry_url}}\">Retry</a></p>",
    },
    push: {
      subject: "Payment failed",
      text: "We could not charge {{currency}} {{amount}}.",
      html: "<p>We could not charge {{currency}} {{amount}}.</p>",
    },
  },
  security_alert: {
    email: {
      subject: "New sign-in to your account",
      text: "Hi {{display_name}}, a new device signed in: {{device}} in {{location}} at {{occurred_at}}. If this was not you, contact support.",
      html: "<p>Hi {{display_name}},</p><p>A new device signed in:</p><ul><li>{{device}}</li><li>{{location}}</li><li>{{occurred_at}}</li></ul><p>If this was not you, contact support.</p>",
    },
    in_app: {
      subject: "New sign-in",
      text: "{{device}} in {{location}} at {{occurred_at}}.",
      html: "<p>{{device}} in {{location}} at {{occurred_at}}.</p>",
    },
    push: {
      subject: "New sign-in",
      text: "{{device}} in {{location}}.",
      html: "<p>{{device}} in {{location}}.</p>",
    },
  },
  winback: {
    email: {
      subject: "We miss you, {{display_name}}",
      text: "Hi {{display_name}}, {{offer}}. Book in the next week and we will take care of the rest.",
      html: "<p>Hi {{display_name}},</p><p><strong>{{offer}}</strong></p><p>Book in the next week and we will take care of the rest.</p>",
    },
    in_app: {
      subject: "A little something for you",
      text: "{{offer}}.",
      html: "<p>{{offer}}.</p>",
    },
    push: {
      subject: "We miss you",
      text: "{{offer}}.",
      html: "<p>{{offer}}.</p>",
    },
  },
} as const;

const seedTemplates = async () => {
  const locales = ["en", "hi-IN"];

  for (const [templateKey, channels] of Object.entries(templateContent)) {
    for (const channel of CHANNELS) {
      const content = channels[channel];

      for (const locale of locales) {
        if (locale !== "en" && templateKey !== "booking_confirmation") {
          continue;
        }

        const localized =
          locale === "hi-IN"
            ? {
                subject: "आपकी {{service}} बुकिंग की पुष्टि हुई",
                text: "नमस्ते {{display_name}}, {{service}} बुकिंग {{booking_id}} {{pro_name}} के साथ {{scheduled_for}} के लिए पुष्टि हुई।",
                html: content.html,
              }
            : content;

        const templateId = newId();
        const versionId = newId();

        await db.template.create({
          data: {
            id: templateId,
            key: templateKey,
            channel: channel.toUpperCase() as never,
            locale,
            name: `${templateKey} ${channel} ${locale}`,
            status: "DRAFT",
          },
        });

        await db.templateVersion.create({
          data: {
            id: versionId,
            templateId,
            version: 1,
            subject: localized.subject,
            html: localized.html,
            text: localized.text,
            variablesSchema: {
              required: Object.keys(
                ["display_name", "service", "booking_id", "pro_name", "scheduled_for", "address_label"],
              ),
            },
            publishedAt: new Date(),
            createdBy: "seed",
          },
        });

        await db.template.update({
          where: { id: templateId },
          data: { currentVersionId: versionId, status: "PUBLISHED" },
        });
      }
    }
  }
};

const seedEventTypes = async () => {
  for (const definition of EVENT_CATALOG) {
    await db.eventType.create({
      data: {
        id: newId(),
        key: definition.key,
        schema: EVENT_SCHEMAS[definition.key] ?? { type: "object" },
        defaultPriority: definition.default_priority.toUpperCase() as never,
        policy: definition.policy as never,
        allowedChannels: definition.allowed_channels.map((channel) => channel.toUpperCase() as never),
        allowedSources: definition.allowed_sources.map((source) => source.toUpperCase() as never),
        dedupeWindowSeconds: definition.dedupe_window_seconds,
        status: "ACTIVE",
        version: definition.schema_version,
      },
    });
  }
};

const seedUsers = async (scale: "small" | "load") => {
  const customers = scale === "load" ? 100_000 : 1_400;
  const pros = scale === "load" ? 0 : 600;
  const ops = scale === "load" ? 0 : 200;
  const total = customers + pros + ops;
  const chunk: Array<Record<string, unknown>> = [];
  const preferenceRows: Array<Record<string, unknown>> = [];
  const settingsRows: Array<Record<string, unknown>> = [];
  const deviceRows: Array<Record<string, unknown>> = [];
  const consentRows: Array<Record<string, unknown>> = [];
  const suppressionRows: Array<Record<string, unknown>> = [];

  const flush = async () => {
    if (chunk.length === 0) {
      return;
    }

    await db.user.createMany({ data: chunk as never[] });
    await db.preference.createMany({ data: preferenceRows as never[], skipDuplicates: true });
    await db.userSettings.createMany({ data: settingsRows as never[], skipDuplicates: true });
    await db.device.createMany({ data: deviceRows as never[], skipDuplicates: true });
    await db.consentEvent.createMany({ data: consentRows as never[], skipDuplicates: true });
    await db.suppressionList.createMany({ data: suppressionRows as never[], skipDuplicates: true });
    chunk.length = 0;
    preferenceRows.length = 0;
    settingsRows.length = 0;
    deviceRows.length = 0;
    consentRows.length = 0;
    suppressionRows.length = 0;
  };

  for (let index = 0; index < total; index += 1) {
    const isCustomer = index < customers;
    const isPro = !isCustomer && index < customers + pros;
    const kind = isCustomer ? "customer" : isPro ? "pro" : "ops";
    const prefix = kind === "customer" ? "cust" : kind;
    const externalId = `${prefix}_${String(index + 1).padStart(5, "0")}`;
    const userId = userIdFromExternalId(externalId);
    const first = FIRST_NAMES[index % FIRST_NAMES.length] as string;
    const last = LAST_NAMES[index % LAST_NAMES.length] as string;
    const city = isCustomer
      ? index < 1_000
        ? "Pune"
        : index < 1_200
          ? "Mumbai"
          : "Bengaluru"
      : null;
    const displayName = `${first} ${last}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}.${index + 1}@example.test`;
    const phone = `+9198${String(10_000_000 + index).slice(-8)}`;
    const marketing = kind === "customer" && city === "Pune";
    const lastBookingDays = marketing ? 75 + (index % 40) : 5 + (index % 40);

    chunk.push({
      id: userId,
      externalId,
      kind: kind.toUpperCase(),
      email,
      phone,
      displayName,
      locale: index % 17 === 0 ? "hi-IN" : "en-IN",
      timezone: "Asia/Kolkata",
      status: "ACTIVE",
      city,
      lastBookingAt: new Date(Date.now() - lastBookingDays * 86_400_000),
      attributes: { seeded: true, cohort: marketing ? "winback" : "active" },
    });

    for (const category of ["booking", "billing", "security"]) {
      for (const channel of CHANNELS) {
        preferenceRows.push({
          userId,
          category,
          channel: channel.toUpperCase(),
          enabled: true,
          source: "OPS",
        });
      }
    }

    if (marketing) {
      for (const channel of CHANNELS) {
        preferenceRows.push({
          userId,
          category: "marketing",
          channel: channel.toUpperCase(),
          enabled: true,
          source: "GROWTH",
        });

        consentRows.push({
          id: newId(),
          userId,
          category: "marketing",
          channel: channel.toUpperCase(),
          action: "GRANTED",
          source: "GROWTH",
        });
      }
    }

    settingsRows.push({
      userId,
      quietStart: index % 9 === 0 ? "22:00" : null,
      quietEnd: index % 9 === 0 ? "07:00" : null,
      marketingPaused: false,
    });

    if (index % 3 === 0) {
      const tokenHash = hashAddress(`push-token-${externalId}`, config.apiKeyPepper);
      deviceRows.push({
        id: newId(),
        userId,
        platform: index % 2 === 0 ? "ANDROID" : "IOS",
        tokenHash,
        status: "ACTIVE",
        lastSeenAt: new Date(),
      });
    }

    if (index >= 10 && index < 15) {
      suppressionRows.push({
        id: newId(),
        channel: "EMAIL",
        addressHash: hashAddress(email, config.apiKeyPepper),
        reason: "hard_bounce",
        provider: "smtp",
      });
    }

    if (chunk.length >= 500) {
      await flush();
    }
  }

  await flush();
  return total;
};

const seedApiClients = async () => {
  const keys: Record<string, string> = {};

  for (const source of Object.keys(SCOPES_BY_SOURCE) as Source[]) {
    const raw = `hrld_demo_${source}_${hashToken(`${source}:demo`, config.apiKeyPepper).slice(0, 24)}`;
    const prefix = raw.slice(0, 20);
    const id = newId();

    await db.apiClient.create({
      data: {
        id,
        source: source.toUpperCase() as never,
        kind: "SERVICE",
        name: `${source} demo key`,
        keyPrefix: prefix,
        keyHash: hashToken(raw, config.apiKeyPepper),
        scopes: SCOPES_BY_SOURCE[source],
        expiresAt: new Date(Date.now() + 365 * 86_400_000),
        createdBy: "seed",
      },
    });

    keys[source] = raw;
  }

  return keys;
};

const seedCampaign = async () => {
  const template = await db.template.findUnique({
    where: {
      key_channel_locale: {
        key: "winback",
        channel: "EMAIL",
        locale: "en",
      },
    },
  });

  if (!template) {
    return;
  }

  await db.campaign.create({
    data: {
      id: newId(),
      name: "Pune winback",
      templateId: template.id,
      channel: "EMAIL",
      audience: {
        kinds: ["customer"],
        city: "Pune",
        inactive_days: 30,
        marketing_opt_in: true,
      },
      payload: { offer: "20 percent off your next cleaning" },
      rateLimit: config.campaignRateLimit,
      status: "DRAFT",
      createdBy: "seed",
    },
  });
};

const clear = async () => {
  await db.deadLetter.deleteMany();
  await db.providerFault.deleteMany();
  await db.auditLog.deleteMany();
  await db.jobRun.deleteMany();
  await db.campaignRecipient.deleteMany();
  await db.campaign.deleteMany();
  await db.inboxItem.deleteMany();
  await db.deliveryAttempt.deleteMany();
  await db.retrySchedule.deleteMany();
  await db.providerEvent.deleteMany();
  await db.delivery.deleteMany();
  await db.fanoutPlan.deleteMany();
  await db.notificationEvent.deleteMany();
  await db.notification.deleteMany();
  await db.outbox.deleteMany();
  await db.consentEvent.deleteMany();
  await db.suppressionList.deleteMany();
  await db.device.deleteMany();
  await db.preference.deleteMany();
  await db.userSettings.deleteMany();
  await db.templateVersion.updateMany({ data: { publishedAt: null } });
  await db.template.updateMany({ data: { currentVersionId: null } });
  await db.templateVersion.deleteMany();
  await db.template.deleteMany();
  await db.eventType.deleteMany();
  await db.user.deleteMany();
  await db.apiClient.deleteMany();
  await db.sourceControl.deleteMany();
};

const main = async () => {
  const scaleArg = process.argv.find((argument) => argument.startsWith("--scale="));
  const scale = (process.env["SEED_SCALE"] ?? scaleArg?.split("=")[1]) === "load" ? "load" : "small";

  console.log(`seeding ${scale} dataset`);

  await clear();
  await seedEventTypes();
  await seedTemplates();
  const users = await seedUsers(scale);
  const keys = await seedApiClients();
  await seedCampaign();

  for (const source of Object.keys(SCOPES_BY_SOURCE) as Source[]) {
    await db.sourceControl.create({ data: { source: source.toUpperCase() as never } });
  }

  const directory =
    process.env["HERALD_DEMO_DIR"] ?? resolve(process.cwd(), "../../.herald");
  mkdirSync(directory, { recursive: true });
  const envFile = resolve(directory, "demo.env");
  const lines = [
    "HERALD_API_URL=http://localhost:3000",
    `HERALD_OPS_API_KEY=${keys.ops}`,
    `HERALD_BOOKING_API_KEY=${keys.booking}`,
    `HERALD_PAYMENTS_API_KEY=${keys.payments}`,
    `HERALD_SECURITY_API_KEY=${keys.security}`,
    `HERALD_GROWTH_API_KEY=${keys.growth}`,
    `HERALD_WEBHOOK_SECRET=${config.webhookSecret}`,
    `HERALD_MAILPIT_URL=${config.mailpitUrl}`,
  ];
  writeFileSync(envFile, `${lines.join("\n")}\n`, { mode: 0o600 });

  console.log(`seeded ${users} users`);
  console.log(`demo credentials written to ${envFile}`);
  console.log(`ops key prefix ${keys.ops?.slice(0, 20)}`);
  console.log(`api http://localhost:${config.port}`);
  console.log(`mailpit ${config.mailpitUrl}`);
};

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
