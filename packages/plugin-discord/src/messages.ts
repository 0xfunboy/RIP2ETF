import {
  ChannelType,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Media,
  type Memory,
  ServiceType,
  type UUID,
  MemoryType,
  createUniqueUuid,
  logger,
} from '@elizaos/core';
import {
  type Channel,
  type Client,
  ChannelType as DiscordChannelType,
  type Message as DiscordMessage,
  type TextChannel,
} from 'discord.js';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AttachmentManager } from './attachments';
import { getDiscordSettings } from './environment';
import { DiscordSettings } from './types';
import { canSendMessage, sendMessageInChunks } from './utils';

/**
 * Class representing a Message Manager for handling Discord messages.
 */

export class MessageManager {
  private client: Client;
  private runtime: IAgentRuntime;
  private attachmentManager: AttachmentManager;
  private getChannelType: (channel: Channel) => Promise<ChannelType>;
  private discordSettings: DiscordSettings;
  /**
   * Constructor for a new instance of MyClass.
   * @param {any} discordClient - The Discord client object.
   */
  constructor(discordClient: any) {
    this.client = discordClient.client;
    this.runtime = discordClient.runtime;
    this.attachmentManager = new AttachmentManager(this.runtime);
    this.getChannelType = discordClient.getChannelType;
    // Load Discord settings with proper priority (env vars > character settings > defaults)
    this.discordSettings = getDiscordSettings(this.runtime);
  }

  /**
   * Handles incoming Discord messages and processes them accordingly.
   *
   * @param {DiscordMessage} message - The Discord message to be handled
   */
  async handleMessage(message: DiscordMessage) {
    // this filtering is already done in setupEventListeners
    /*
    if (
      this.discordSettings.allowedChannelIds?.length &&
      !this.discordSettings.allowedChannelIds.some((id: string) => id === message.channel.id)
    ) {
      return;
    }
    */

    if (message.interaction || message.author.id === this.client.user?.id) {
      return;
    }

    if (this.discordSettings.shouldIgnoreBotMessages && message.author?.bot) {
      return;
    }

    if (
      this.discordSettings.shouldIgnoreDirectMessages &&
      message.channel.type === DiscordChannelType.DM
    ) {
      return;
    }

    const isBotMentioned = !!(
      this.client.user?.id && message.mentions.users?.has(this.client.user.id)
    );
    const isReplyToBot =
      !!message.reference?.messageId && message.mentions.repliedUser?.id === this.client.user?.id;
    const isInThread = message.channel.isThread();
    const isDM = message.channel.type === DiscordChannelType.DM;

    if (this.discordSettings.shouldRespondOnlyToMentions) {
      const shouldProcess = isDM || isBotMentioned || isReplyToBot;

      if (!shouldProcess) {
        logger.debug('[Discord] Strict mode: ignoring message (no @mention or reply)');
        return;
      }

      logger.debug('[Discord] Strict mode: processing message (has @mention or reply)');
    }

    const entityId = createUniqueUuid(this.runtime, message.author.id);

    const userName = message.author.bot
      ? `${message.author.username}#${message.author.discriminator}`
      : message.author.username;
    const name = message.author.displayName;
    const channelId = message.channel.id;
    const roomId = createUniqueUuid(this.runtime, channelId);

    // can't be null
    let type: ChannelType;
    let serverId: string | undefined;

    if (message.guild) {
      const guild = await message.guild.fetch();
      type = await this.getChannelType(message.channel as Channel);
      if (type === null) {
        // usually a forum type post
        logger.warn('null channel type, discord message', message.id);
      }
      serverId = guild.id;
    } else {
      type = ChannelType.DM;
      // really can't be undefined because bootstrap's choice action
      serverId = message.channel.id;
    }

    await this.runtime.ensureConnection({
      entityId,
      roomId,
      userName,
      name: name,
      source: 'discord',
      channelId: message.channel.id,
      serverId,
      type,
      worldId: createUniqueUuid(this.runtime, serverId ?? roomId) as UUID,
      worldName: message.guild?.name,
    });

    try {
      const canSendResult = canSendMessage(message.channel);
      if (!canSendResult.canSend) {
        return logger.warn(
          `Cannot send message to channel ${message.channel}`,
          canSendResult.reason || undefined
        );
      }

      const { processedContent, attachments } = await this.processMessage(message);

      const audioAttachments = message.attachments.filter((attachment) =>
        attachment.contentType?.startsWith('audio/')
      );

      if (audioAttachments.size > 0) {
        const processedAudioAttachments =
          await this.attachmentManager.processAttachments(audioAttachments);
        attachments.push(...processedAudioAttachments);
      }

      if (!processedContent && !attachments?.length) {
        // Only process messages that are not empty
        return;
      }

      const messageId = createUniqueUuid(this.runtime, message.id);

      const channel = message.channel as TextChannel;

      // Store the typing data to be used by the callback
      const typingData = {
        interval: null as NodeJS.Timeout | null,
        cleared: false,
        started: false,
      };

      const sourceId = entityId; // needs to be based on message.author.id

      const newMessage: Memory = {
        id: messageId,
        entityId: entityId,
        agentId: this.runtime.agentId,
        roomId: roomId,
        content: {
          text: processedContent || ' ',
          attachments: attachments,
          source: 'discord',
          channelType: type,
          url: message.url,
          inReplyTo: message.reference?.messageId
            ? createUniqueUuid(this.runtime, message.reference?.messageId)
            : undefined,
          mentionContext: {
            isMention: isBotMentioned,
            isReply: isReplyToBot,
            isThread: isInThread,
            mentionType: isBotMentioned
              ? 'platform_mention'
              : isReplyToBot
                ? 'reply'
                : isInThread
                  ? 'thread'
                  : 'none',
          },
        },
        // metadata of memory
        metadata: {
          entityName: name,
          fromBot: message.author.bot,
          // include very technical/exact reference to this user for security reasons
          // don't remove or change this, spartan needs this
          fromId: message.author.id,
          // do we need to duplicate this, we have it in content
          // source: "discord",
          sourceId,
          // why message? all Memories contain content (which is basically a message)
          // what are the other types? see MemoryType
          type: MemoryType.MESSAGE,
          // scope: `shared`, `private`, or `room
          // timestamp
          // tags
        },
        createdAt: message.createdTimestamp,
      };

      const callback: HandlerCallback = async (
        content: Content,
        files?: Array<{ attachment: Buffer | string; name: string }>
      ) => {
        try {
          // not addressed to us
          if (
            content.target &&
            typeof content.target === 'string' &&
            content.target.toLowerCase() !== 'discord'
          ) {
            return [];
          }

          // Start typing indicator only when we're actually going to respond
          if (!typingData.started) {
            typingData.started = true;

            const startTyping = () => {
              try {
                // sendTyping is not available at test time
                if (channel.sendTyping) {
                  channel.sendTyping();
                }
              } catch (err) {
                logger.warn('Error sending typing indicator:', String(err));
              }
            };

            // Start typing immediately
            startTyping();

            // Create interval to keep the typing indicator active while processing
            typingData.interval = setInterval(startTyping, 8000);

            // Add a small delay to ensure typing indicator is visible
            // This simulates the bot "thinking" before responding
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }

          if (message.id && !content.inReplyTo) {
            content.inReplyTo = createUniqueUuid(this.runtime, message.id);
          }

          let filesToSend: Array<{ attachment: Buffer | string; name: string }> = files || [];

          if (content.attachments && content.attachments.length > 0) {
            const prepared = await this.prepareOutgoingAttachments(content.attachments);
            if (prepared.length > 0) {
              filesToSend = filesToSend.concat(prepared);
            }
          }

          let messages: any[] = [];
          if (content?.channelType === 'DM') {
            const u = await this.client.users.fetch(message.author.id);
            if (!u) {
              logger.warn('Discord - User not found', message.author.id);
              return [];
            }
            await u.send(content.text || '');
            messages = [content];
          } else {
            messages = await sendMessageInChunks(
              channel,
              content.text ?? '',
              message.id!,
              filesToSend
            );
          }

          const memories: Memory[] = [];
          for (const m of messages) {
            const actions = content.actions;

            const memory: Memory = {
              id: createUniqueUuid(this.runtime, m.id),
              entityId: this.runtime.agentId,
              agentId: this.runtime.agentId,
              content: {
                ...content,
                actions,
                inReplyTo: messageId,
                url: m.url,
                channelType: type,
              },
              roomId,
              createdAt: m.createdTimestamp,
            };
            memories.push(memory);
          }

          for (const m of memories) {
            await this.runtime.createMemory(m, 'messages');
          }

          // Clear typing indicator when done
          if (typingData.interval && !typingData.cleared) {
            clearInterval(typingData.interval);
            typingData.cleared = true;
          }

          return memories;
        } catch (error) {
          console.error('Error handling message:', error);
          // Clear typing indicator on error
          if (typingData.interval && !typingData.cleared) {
            clearInterval(typingData.interval);
            typingData.cleared = true;
          }
          return [];
        }
      };

      // Call the message handler directly instead of emitting events
      // This provides a clearer, more traceable flow for message processing
      await this.runtime.messageService.handleMessage(this.runtime, newMessage, callback);

      // Failsafe: clear typing indicator after 30 seconds if it was started and something goes wrong
      setTimeout(() => {
        if (typingData.started && typingData.interval && !typingData.cleared) {
          clearInterval(typingData.interval);
          typingData.cleared = true;
          logger.warn('Typing indicator failsafe timeout triggered');
        }
      }, 30000);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  private async prepareOutgoingAttachments(
    attachments: Media[]
  ): Promise<Array<{ attachment: Buffer; name: string }>> {
    const files: Array<{ attachment: Buffer; name: string }> = [];

    for (let index = 0; index < attachments.length; index++) {
      const attachment = attachments[index];
      try {
        const data = await this.resolveAttachmentBuffer(attachment);
        if (!data) continue;

        const extension = this.inferExtension(attachment.contentType ?? data.mimeType);
        const baseName = this.sanitizeFilename(
          attachment.title || attachment.source || `attachment-${index + 1}`
        );

        files.push({
          attachment: data.buffer,
          name: `${baseName}.${extension}`,
        });
      } catch (error) {
        logger.warn(
          { error, attachment: attachment.id ?? `index-${index}` },
          '[Discord] Failed to prepare attachment for sending'
        );
      }
    }

    return files;
  }

  private async resolveAttachmentBuffer(
    attachment: Media
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!attachment.url) {
      return null;
    }

    if (attachment.url.startsWith('data:')) {
      const match = attachment.url.match(/^data:(.*?);base64,(.*)$/);
      if (!match) return null;
      const [, mimeType, data] = match;
      return {
        buffer: Buffer.from(data, 'base64'),
        mimeType: mimeType || attachment.contentType || 'application/octet-stream',
      };
    }

    if (attachment.url.startsWith('file://')) {
      const filePath = fileURLToPath(attachment.url);
      const buffer = await fs.readFile(filePath);
      return {
        buffer,
        mimeType: attachment.contentType || 'application/octet-stream',
      };
    }

    if (attachment.url.startsWith('/')) {
      const buffer = await fs.readFile(attachment.url);
      return {
        buffer,
        mimeType: attachment.contentType || 'application/octet-stream',
      };
    }

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Failed to download attachment (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const mimeType =
      attachment.contentType || response.headers.get('content-type') || 'application/octet-stream';

    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
    };
  }

  private sanitizeFilename(name: string): string {
    const normalized = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || 'attachment';
  }

  private inferExtension(mimeType?: string): string {
    if (!mimeType) return 'bin';
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
    if (mimeType.includes('gif')) return 'gif';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('pdf')) return 'pdf';
    return 'bin';
  }

  /**
   * Processes the message content, mentions, code blocks, attachments, and URLs to generate
   * processed content and media attachments.
   *
   * @param {DiscordMessage} message The message to process
   * @returns {Promise<{ processedContent: string; attachments: Media[] }>} Processed content and media attachments
   */
  async processMessage(
    message: DiscordMessage
  ): Promise<{ processedContent: string; attachments: Media[] }> {
    let processedContent = message.content;
    let attachments: Media[] = [];

    if (message.embeds.length) {
      for (const i in message.embeds) {
        const embed = message.embeds[i];
        // type: rich
        processedContent += '\nEmbed #' + (parseInt(i) + 1) + ':\n';
        processedContent += '  Title:' + (embed.title ?? '(none)') + '\n';
        processedContent += '  Description:' + (embed.description ?? '(none)') + '\n';
      }
    }
    if (message.reference && message.reference.messageId) {
      const messageId = createUniqueUuid(this.runtime, message.reference.messageId);
      // context currently doesn't know message ID
      processedContent +=
        '\nReferencing MessageID ' + messageId + ' (discord: ' + message.reference.messageId + ')';
      // in our channel
      if (message.reference.channelId !== message.channel.id) {
        const roomId = createUniqueUuid(this.runtime, message.reference.channelId);
        processedContent += ' in channel ' + roomId;
      }
      // in our guild
      if (
        message.reference.guildId &&
        message.guild &&
        message.reference.guildId !== message.guild.id
      ) {
        processedContent += ' in guild ' + message.reference.guildId;
      }
      processedContent += '\n';
    }

    const mentionRegex = /<@!?(\d+)>/g;
    processedContent = processedContent.replace(mentionRegex, (match, entityId) => {
      const user = message.mentions.users.get(entityId);
      if (user) {
        return `${user.username} (@${entityId})`;
      }
      return match;
    });

    const codeBlockRegex = /```([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(processedContent))) {
      const codeBlock = match[1];
      const lines = codeBlock.split('\n');
      const title = lines[0];
      const description = lines.slice(0, 3).join('\n');
      const attachmentId = `code-${Date.now()}-${Math.floor(Math.random() * 1000)}`.slice(-5);
      attachments.push({
        id: attachmentId,
        url: '',
        title: title || 'Code Block',
        source: 'Code',
        description: description,
        text: codeBlock,
      });
      processedContent = processedContent.replace(match[0], `Code Block (${attachmentId})`);
    }

    if (message.attachments.size > 0) {
      attachments = await this.attachmentManager.processAttachments(message.attachments);
    }

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = processedContent.match(urlRegex) || [];

    for (const url of urls) {
      // Use string literal type for getService, assume methods exist at runtime
      const videoService = this.runtime.getService(ServiceType.VIDEO) as any; // Cast to any
      if (videoService?.isVideoUrl(url)) {
        const videoInfo = await videoService.processVideo(url, this.runtime);

        attachments.push({
          id: `youtube-${Date.now()}`,
          url: url,
          title: videoInfo.title,
          source: 'YouTube',
          description: videoInfo.description,
          text: videoInfo.text,
        });
      } else {
        // Use string literal type for getService, assume methods exist at runtime
        const browserService = this.runtime.getService(ServiceType.BROWSER) as any; // Cast to any
        if (!browserService) {
          logger.warn('Browser service not found');
          continue;
        }

        const { title, description: summary } = await browserService.getPageContent(
          url,
          this.runtime
        );

        attachments.push({
          id: `webpage-${Date.now()}`,
          url: url,
          title: title || 'Web Page',
          source: 'Web',
          description: summary,
          text: summary,
        });
      }
    }

    return { processedContent, attachments };
  }

  /**
   * Asynchronously fetches the bot's username and discriminator from Discord API.
   *
   * @param {string} botToken The token of the bot to authenticate the request
   * @returns {Promise<string>} A promise that resolves with the bot's username and discriminator
   * @throws {Error} If there is an error while fetching the bot details
   */

  async fetchBotName(botToken: string) {
    const url = 'https://discord.com/api/v10/users/@me';
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error fetching bot details: ${response.statusText}`);
    }

    const data = await response.json();
    const discriminator = data.discriminator;
    return (data as { username: string }).username + (discriminator ? `#${discriminator}` : '');
  }
}
