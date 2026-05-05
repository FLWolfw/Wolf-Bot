import { 
    getJoinToCreateConfig, 
    removeJoinToCreateTrigger,
    unregisterTemporaryChannel,
    getTicketData,
    saveTicketData
} from '../utils/database.js';
import { getServerCounters, saveServerCounters } from '../services/serverstatsService.js';
import { logger } from '../utils/logger.js';
import { sendLog } from '../utils/discordLogger.js';
import { AuditLogEvent } from 'discord.js';
import { handleChannelDelete } from '../security/antiNuke.js'; // 🔥 NUEVO

export default {
    name: 'channelDelete',
    async execute(channel, client) {

        let executor = null;

        try {
            const fetchedLogs = await channel.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.ChannelDelete
            });

            const log = fetchedLogs.entries.first();

            if (
                log &&
                log.target.id === channel.id &&
                Date.now() - log.createdTimestamp < 5000
            ) {
                executor = log.executor;
            }

        } catch (err) {
            logger.warn('Error leyendo audit logs (channelDelete):', err);
        }

        // 🔥 ANTI-NUKE
        if (executor) {
            await handleChannelDelete(channel, executor);
        }

        // 🔥 LOG
        try {
            await sendLog({
                title: '🗑️ Canal eliminado',
                description: `${channel.name}`,
                color: 0xff0000,
                fields: [
                    {
                        name: '🧑‍💼 Eliminado por',
                        value: executor ? executor.tag : 'Desconocido',
                        inline: true
                    },
                    {
                        name: '📁 Tipo',
                        value: channel.type.toString(),
                        inline: true
                    }
                ]
            });
        } catch (err) {
            logger.warn('Error enviando log de canal eliminado:', err);
        }

        // =========================
        // TODO TU CÓDIGO ORIGINAL ↓
        // =========================

        if (channel.type === 0 && channel.guild) {
            try {
                const ticketData = await getTicketData(channel.guild.id, channel.id);
                if (ticketData && ticketData.status === 'open') {
                    ticketData.status = 'deleted';
                    ticketData.closedAt = new Date().toISOString();
                    await saveTicketData(channel.guild.id, channel.id, ticketData);
                }
            } catch (err) {}
        }

        if (channel.type !== 2 && channel.type !== 4) return;

        const guildId = channel.guild.id;

        try {
            const counters = await getServerCounters(client, guildId);
            const orphanedCounter = counters.find(c => c.channelId === channel.id);
            
            if (orphanedCounter) {
                const updatedCounters = counters.filter(c => c.channelId !== channel.id);
                await saveServerCounters(client, guildId, updatedCounters);
            }

            const config = await getJoinToCreateConfig(client, guildId);

            if (!config.enabled) return;

            if (config.triggerChannels.includes(channel.id)) {
                await removeJoinToCreateTrigger(client, guildId, channel.id);
            }

            if (config.temporaryChannels[channel.id]) {
                await unregisterTemporaryChannel(client, guildId, channel.id);
            }

            if (config.categoryId === channel.id) {
                config.categoryId = null;
                config.enabled = false;
                await client.db.set(`guild:${guildId}:jointocreate`, config);
            }

        } catch (error) {
            logger.error(`Error in channelDelete event for guild ${guildId}:`, error);
        }
    }
};


