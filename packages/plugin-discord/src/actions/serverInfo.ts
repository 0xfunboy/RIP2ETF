import {
  type Action,
  type ActionExample,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import { DiscordService } from '../service';
import { DISCORD_SERVICE_NAME } from '../constants';
import { type Guild } from 'discord.js';

const formatServerInfo = (guild: Guild, detailed: boolean = false): string => {
  const createdAt = new Date(guild.createdAt).toLocaleDateString();
  const memberCount = guild.memberCount;
  const channelCount = guild.channels.cache.size;
  const roleCount = guild.roles.cache.size;
  const emojiCount = guild.emojis.cache.size;
  const boostLevel = guild.premiumTier;
  const boostCount = guild.premiumSubscriptionCount || 0;

  const basicInfo = [
    `🏛️ **Server Information for ${guild.name}**`,
    `**ID:** ${guild.id}`,
    `**Owner:** <@${guild.ownerId}>`,
    `**Created:** ${createdAt}`,
    `**Members:** ${memberCount}`,
    `**Channels:** ${channelCount}`,
    `**Roles:** ${roleCount}`,
    `**Server Level:** ${boostLevel} (${boostCount} boosts)`,
  ];

  if (detailed) {
    const textChannels = guild.channels.cache.filter((ch) => ch.isTextBased()).size;
    const voiceChannels = guild.channels.cache.filter((ch) => ch.isVoiceBased()).size;
    const categories = guild.channels.cache.filter((ch) => ch.type === 4).size; // CategoryChannel type
    const activeThreads = guild.channels.cache.filter((ch) => ch.isThread() && !ch.archived).size;

    const features =
      guild.features.length > 0
        ? guild.features.map((f) => f.toLowerCase().replace(/_/g, ' ')).join(', ')
        : 'None';

    const detailedInfo = [
      '',
      `📊 **Detailed Statistics**`,
      `**Text Channels:** ${textChannels}`,
      `**Voice Channels:** ${voiceChannels}`,
      `**Categories:** ${categories}`,
      `**Active Threads:** ${activeThreads}`,
      `**Custom Emojis:** ${emojiCount}`,
      `**Stickers:** ${guild.stickers.cache.size}`,
      '',
      `🎯 **Server Features**`,
      `**Verification Level:** ${guild.verificationLevel}`,
      `**Content Filter:** ${guild.explicitContentFilter}`,
      `**2FA Requirement:** ${guild.mfaLevel === 1 ? 'Enabled' : 'Disabled'}`,
      `**Features:** ${features}`,
    ];

    if (guild.description) {
      detailedInfo.push(`**Description:** ${guild.description}`);
    }

    if (guild.vanityURLCode) {
      detailedInfo.push(`**Vanity URL:** discord.gg/${guild.vanityURLCode}`);
    }

    return [...basicInfo, ...detailedInfo].join('\n');
  }

  return basicInfo.join('\n');
};

export const serverInfo: Action = {
  name: 'SERVER_INFO',
  similes: [
    'SERVER_INFO',
    'GUILD_INFO',
    'SERVER_STATS',
    'SERVER_DETAILS',
    'ABOUT_SERVER',
    'SERVER_INFORMATION',
    'CHECK_SERVER',
  ],
  description:
    'Get information about the current Discord server including member count, creation date, and other statistics.',
  validate: async (_runtime: IAgentRuntime, message: Memory, _state: State) => {
    return message.content.source === 'discord';
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback
  ) => {
    const discordService = runtime.getService(DISCORD_SERVICE_NAME) as DiscordService;

    if (!discordService || !discordService.client) {
      await callback({
        text: 'Discord service is not available.',
        source: 'discord',
      });
      return;
    }

    try {
      const room = state.data?.room || (await runtime.getRoom(message.roomId));
      if (!room?.serverId) {
        await callback({
          text: "I couldn't determine the current server.",
          source: 'discord',
        });
        return;
      }

      const guild = await discordService.client.guilds.fetch(room.serverId);

      // Check if the request is for detailed info
      const messageText = message.content.text?.toLowerCase() || '';
      const isDetailed =
        messageText.includes('detailed') ||
        messageText.includes('full') ||
        messageText.includes('stats') ||
        messageText.includes('statistics');

      const infoText = formatServerInfo(guild, isDetailed);

      const response: Content = {
        text: infoText,
        source: message.content.source,
      };

      await callback(response);
    } catch (error) {
      logger.error('Error getting server info:', error);
      await callback({
        text: 'I encountered an error while getting server information. Please try again.',
        source: 'discord',
      });
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'show server info',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll get the server information for you.",
          actions: ['SERVER_INFO'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'what are the server stats?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Let me fetch the server statistics.',
          actions: ['SERVER_INFO'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'give me detailed server information',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll provide detailed information about this server.",
          actions: ['SERVER_INFO'],
        },
      },
    ],
  ] as ActionExample[][],
} as Action;

export default serverInfo;
