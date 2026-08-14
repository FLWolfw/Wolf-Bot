import { getGuildConfig } from '../services/guildConfig.js';

const SPANISH = {
  title: '⭐ ¿Qué te pareció tu experiencia con el soporte?',
  description: (ticket) => `Nos gustaría saber qué tal lo hicimos con **${ticket}**.\nSelecciona una valoración; solo te tomará un segundo.`,
  footer: 'Tus comentarios nos ayudan a mejorar.',
  decline: '❌ No, gracias',
};

function isSpanish(config) {
  const value = String(
    config?.language ?? config?.locale ?? config?.lang ?? config?.serverLanguage ?? ''
  ).trim().toLowerCase();
  return value === 'es' || value === 'es-es' || value.startsWith('es-');
}

function getEmbedValue(embed, key) {
  return embed?.data?.[key] ?? embed?.[key];
}

async function translateFeedbackPayload(user, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (!Array.isArray(payload.components) || !Array.isArray(payload.embeds)) return payload;

  const feedbackRow = payload.components.find((row) =>
    Array.isArray(row?.components) && row.components.some((button) =>
      String(button?.data?.custom_id ?? button?.customId ?? '').startsWith('ticket_feedback:')
    )
  );

  const feedbackButton = feedbackRow?.components?.find((button) =>
    String(button?.data?.custom_id ?? button?.customId ?? '').startsWith('ticket_feedback:')
  );

  const customId = String(feedbackButton?.data?.custom_id ?? feedbackButton?.customId ?? '');
  const match = customId.match(/^ticket_feedback:(\d+):(\d+):\d+$/);
  if (!match) return payload;

  const guildId = match[1];
  const config = await getGuildConfig(user.client, guildId).catch(() => null);
  if (!isSpanish(config)) return payload;

  const feedbackEmbed = payload.embeds.find((embed) => {
    const title = String(getEmbedValue(embed, 'title') ?? '');
    return title === '⭐ How was your support experience?';
  });

  if (feedbackEmbed) {
    if (feedbackEmbed.data) {
      feedbackEmbed.data.title = SPANISH.title;
      feedbackEmbed.data.description = SPANISH.description(`ticket-${match[2]}`);
      if (feedbackEmbed.data.footer) feedbackEmbed.data.footer.text = SPANISH.footer;
      else feedbackEmbed.data.footer = { text: SPANISH.footer };
    } else {
      feedbackEmbed.title = SPANISH.title;
      feedbackEmbed.description = SPANISH.description(`ticket-${match[2]}`);
      feedbackEmbed.footer = { text: SPANISH.footer };
    }
  }

  for (const row of payload.components) {
    for (const button of row?.components ?? []) {
      const id = String(button?.data?.custom_id ?? button?.customId ?? '');
      if (id.startsWith(`ticket_feedback_decline:${guildId}:${match[2]}`)) {
        if (button.data) button.data.label = SPANISH.decline;
        else button.label = SPANISH.decline;
      }
    }
  }

  return payload;
}

const originalSend = globalThis.__wolfOriginalUserSend;

if (!originalSend) {
  globalThis.__wolfOriginalUserSend = true;
  const { User } = await import('discord.js');
  const send = User.prototype.send;

  User.prototype.send = async function patchedTicketFeedbackSend(payload, ...args) {
    try {
      payload = await translateFeedbackPayload(this, payload);
    } catch {
      // Never interfere with normal DMs if translation cannot be resolved.
    }
    return send.call(this, payload, ...args);
  };
}
