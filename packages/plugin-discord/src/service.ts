import {
  ChannelType,
  type Character,
  type Content,
  type Entity,
  EventType,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  Role,
  Service,
  type TargetInfo,
  type UUID,
  type World,
  createUniqueUuid,
  logger,
} from '@elizaos/core';
import {
  type Channel,
  ChannelType as DiscordChannelType,
  Client as DiscordJsClient,
  Events,
  GatewayIntentBits,
  type Guild,
  type GuildMember,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  Partials,
  PermissionsBitField,
  type TextChannel,
  type User,
  type Interaction,
  Collection,
} from 'discord.js';
import { DISCORD_SERVICE_NAME } from './constants';
import { getDiscordSettings } from './environment';
import { MessageManager } from './messages';
import { DiscordEventTypes, type IDiscordService, type DiscordSettings } from './types';
import { VoiceManager } from './voice';

/**
 * DiscordService class representing a service for interacting with Discord.
 * @extends Service
 * @implements IDiscordService
 * @property {string} serviceType - The type of service, set to DISCORD_SERVICE_NAME.
 * @property {string} capabilityDescription - A description of the service's capabilities.
 * @property {DiscordJsClient} client - The DiscordJsClient used for communication.
 * @property {Character} character - The character associated with the service.
 * @property {MessageManager} messageManager - The manager for handling messages.
 * @property {VoiceManager} voiceManager - The manager for handling voice communication.
 */

export class DiscordService extends Service implements IDiscordService {
  static serviceType: string = DISCORD_SERVICE_NAME;
  capabilityDescription = 'The agent is able to send and receive messages on discord';
  client: DiscordJsClient | null;
  character: Character;
  messageManager?: MessageManager;
  voiceManager?: VoiceManager;
  private discordSettings: DiscordSettings;
  private userSelections: Map<string, { [key: string]: any }> = new Map();
  private timeouts: NodeJS.Timeout[] = [];
  private clientReadyPromise: Promise<void>;
  /**
   * List of allowed channel IDs (parsed from CHANNEL_IDS env var).
   * If undefined, all channels are allowed.
   */
  private allowedChannelIds?: string[];

  /**
   * Set of dynamically added channel IDs through joinChannel action.
   * These are merged with allowedChannelIds for runtime channel management.
   */
  private dynamicChannelIds: Set<string> = new Set();

  /**
   * Constructor for Discord client.
   * Initializes the Discord client with specified intents and partials,
   * sets up event listeners, and ensures all servers exist.
   *
   * @param {IAgentRuntime} runtime - The AgentRuntime instance
   */
  constructor(runtime: IAgentRuntime) {
    super(runtime);

    // Load Discord settings with proper priority (env vars > character settings > defaults)
    this.discordSettings = getDiscordSettings(runtime);

    this.character = runtime.character;

    // Parse CHANNEL_IDS env var to restrict the bot to specific channels
    const channelIdsRaw = runtime.getSetting('CHANNEL_IDS') as string | undefined;
    if (channelIdsRaw?.trim && channelIdsRaw.trim()) {
      this.allowedChannelIds = channelIdsRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      this.runtime.logger.debug('Locking down discord to', this.allowedChannelIds)
    }

    // Check if Discord API token is available and valid
    const token = runtime.getSetting('DISCORD_API_TOKEN') as string;
    if (!token || token?.trim && token.trim() === '') {
      this.runtime.logger.warn('Discord API Token not provided - Discord functionality will be unavailable');
      this.client = null;
      return;
    }

    try {
      this.client = new DiscordJsClient({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.GuildPresences,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.GuildVoiceStates,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessageTyping,
          GatewayIntentBits.GuildMessageTyping,
          GatewayIntentBits.GuildMessageReactions,
        ],
        partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction],
      });

      this.runtime = runtime;
      this.voiceManager = new VoiceManager(this, runtime);
      this.messageManager = new MessageManager(this);

      this.clientReadyPromise = new Promise(resolver => {
        this.client.once(Events.ClientReady, (readyClient) => {
          resolver()
          this.onReady(readyClient)
        });
        this.client.login(token).catch((error) => {
          this.runtime.logger.error(
            `Failed to login to Discord: ${error instanceof Error ? error.message : String(error)}`
          );
          this.client = null;
        });
      })

      this.setupEventListeners();
      this.registerSendHandler(); // Register handler during construction
    } catch (error) {
      runtime.logger.error(
        `Error initializing Discord client: ${error instanceof Error ? error.message : String(error)}`
      );
      this.client = null;
    }
  }

  static async start(runtime: IAgentRuntime) {
    const service = new DiscordService(runtime);
    return service;
  }

  /**
   * Registers the send handler with the runtime.
   * @private
   */
  private registerSendHandler(): void {
    if (this.runtime) {
      this.runtime.registerSendHandler('discord', this.handleSendMessage.bind(this));
    }
  }

  /**
   * The SendHandlerFunction implementation for Discord.
   * @param {IAgentRuntime} runtime - The runtime instance.
   * @param {TargetInfo} target - The target information for the message.
   * @param {Content} content - The content of the message to send.
   * @returns {Promise<void>} A promise that resolves when the message is sent or rejects on error.
   * @throws {Error} If the client is not ready, target is invalid, or sending fails.
   */
  async handleSendMessage(
    // why we have this.runtime on the agent itself and this isn't a static
    runtime: IAgentRuntime,
    target: TargetInfo,
    content: Content
  ): Promise<void> {
    if (!this.client?.isReady()) {
      runtime.logger.error('[Discord SendHandler] Client not ready.');
      throw new Error('Discord client is not ready.');
    }

    // Skip sending if channel restrictions are set and target channel is not allowed
    if (target.channelId && this.allowedChannelIds && !this.isChannelAllowed(target.channelId)) {
      runtime.logger.warn(
        `[Discord SendHandler] Channel ${target.channelId} is not in allowed channels, skipping send.`
      );
      return;
    }

    let targetChannel: Channel | undefined | null = null;

    try {
      // Determine target based on provided info
      if (target.channelId) {
        targetChannel = await this.client.channels.fetch(target.channelId);
      } else if (target.entityId) {
        // Attempt to convert runtime UUID to Discord snowflake ID
        // NOTE: This assumes a mapping exists or the UUID *is* the snowflake ID
        const discordUserId = target.entityId as string; // May need more robust conversion
        const user = await this.client.users.fetch(discordUserId);
        if (user) {
          targetChannel = (await user.dmChannel) ?? (await user.createDM());
        }
      } else {
        throw new Error('Discord SendHandler requires channelId or entityId.');
      }

      if (!targetChannel) {
        throw new Error(
          `Could not find target Discord channel/DM for target: ${JSON.stringify(target)}`
        );
      }

      // Type guard to ensure the channel is text-based
      if (targetChannel.isTextBased() && !targetChannel.isVoiceBased()) {
        // Further check if it's a channel where bots can send messages
        if ('send' in targetChannel && typeof targetChannel.send === 'function') {
          if (content.text) {
            // Split message if longer than Discord limit (2000 chars)
            const chunks = this.splitMessage(content.text, 2000);
            for (const chunk of chunks) {
              await targetChannel.send(chunk);
            }
          } else {
            runtime.logger.warn('[Discord SendHandler] No text content provided to send.');
          }
          // TODO: Add attachment handling here if necessary
        } else {
          throw new Error(`Target channel ${targetChannel.id} does not have a send method.`);
        }
      } else {
        throw new Error(
          `Target channel ${targetChannel.id} is not a valid text-based channel for sending messages.`
        );
      }
    } catch (error) {
      runtime.logger.error(
        `[Discord SendHandler] Error sending message: ${error instanceof Error ? error.message : String(error)} - Target: ${JSON.stringify(target)}, Content: ${JSON.stringify(content)}`
      );
      throw error;
    }
  }

  /**
   * Helper function to split a string into chunks of a maximum length.
   *
   * @param {string} text - The text to split.
   * @param {number} maxLength - The maximum length of each chunk.
   * @returns {string[]} An array of text chunks.
   * @private
   */
  // Helper to split messages
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = text.split('\n');
    for (const line of lines) {
      if (currentChunk.length + line.length + 1 <= maxLength) {
        currentChunk += (currentChunk ? '\n' : '') + line;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        // Handle lines longer than the max length (split them)
        if (line.length > maxLength) {
          for (let i = 0; i < line.length; i += maxLength) {
            chunks.push(line.substring(i, i + maxLength));
          }
          currentChunk = ''; // Reset chunk after splitting long line
        } else {
          currentChunk = line;
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  /**
   * Set up event listeners for the client.
   * @private
   */
  private setupEventListeners() {
    if (!this.client) {
      return; // Skip if client is not available
    }

    const listenCidsRaw: string | string[] | undefined = this.runtime.getSetting('DISCORD_LISTEN_CHANNEL_IDS');
    const listenCids = Array.isArray(listenCidsRaw)
      ? listenCidsRaw
      : (listenCidsRaw && typeof listenCidsRaw === 'string' && listenCidsRaw.trim())
        ? listenCidsRaw.trim().split(',').map(s => s.trim()).filter(s => s.length > 0)
        : []
    const talkCids = this.allowedChannelIds ?? [] // CHANNEL_IDS
    const allowedCids = [...listenCids, ...talkCids]

    // Setup handling for direct messages
    this.client.on('messageCreate', async (message) => {
      // Skip if we're sending the message or in deleted state
      if (
        message.author.id === this.client?.user?.id ||
        (message.author.bot && this.discordSettings.shouldIgnoreBotMessages)
      ) {
        this.runtime.logger.info(
          `Got message where author is ${
            message.author.bot && this.discordSettings.shouldIgnoreBotMessages
              ? 'a bot. To reply anyway, set \`shouldIgnoreBotMessages=true\`.'
              : 'the current user. Ignore!'
          }`
        );
        return;
      }

      if (listenCids.includes(message.channel.id)) {
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
            this.runtime.logger.warn('null channel type, discord message', message);
          }
          serverId = guild.id;
        } else {
          type = ChannelType.DM;
          // really can't be undefined because bootstrap's choice action
          serverId = message.channel.id;
        }

        // is this needed? just track who's in what room
        /*
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
        */

        // only we just need to remember these messages
        const { processedContent, attachments } = await this.messageManager.processMessage(message);

        const messageId = createUniqueUuid(this.runtime, message.id);
        const sourceId = entityId; // needs to be based on message.author.id

        const newMessage: Memory = {
          id: messageId,
          entityId: entityId,
          agentId: this.runtime.agentId,
          roomId: roomId,
          content: {
            // name: name,
            // userName: userName,
            text: processedContent || ' ',
            attachments: attachments,
            source: 'discord',
            channelType: type,
            url: message.url,
            inReplyTo: message.reference?.messageId
              ? createUniqueUuid(this.runtime, message.reference?.messageId)
              : undefined,
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
            type: 'message', // MemoryType.MESSAGE
            // scope: `shared`, `private`, or `room
            // timestamp
            // tags
          },
          createdAt: message.createdTimestamp,
        };

        // and then you can handle these anyway you want
        this.runtime.emitEvent('DISCORD_LISTEN_CHANNEL_MESSAGE', {
          runtime: this.runtime,
          message: newMessage,
        });
      }

      // Skip if channel restrictions are set and this channel is not allowed
      if (this.allowedChannelIds && !this.isChannelAllowed(message.channel.id)) {
        // check first whether the channel is a thread...
        const channel = await this.client?.channels.fetch(message.channel.id);

        this.runtime.emitEvent('DISCORD_NOT_IN_CHANNELS_MESSAGE', {
          runtime: this.runtime,
          message: message,
        });

        if (!channel) {
          this.runtime.logger.error(`Channel id ${message.channel.id} not found. Ignore!`);
          return;
        }
        if (channel.isThread()) {
          if (!channel.parentId || !this.isChannelAllowed(channel.parentId)) {
            this.runtime.logger.info(
              `Thread not in an allowed channel. Add the channel ${channel.parentId} to CHANNEL_IDS to enable replies.`
            );
            return;
          }
        } else {
          if (channel?.isTextBased()) {
            const channelLabel = 'name' in channel ? channel.name : channel.id;
            this.runtime.logger.debug(
              `Channel ${channelLabel} not allowed. Add the channel ${channel.id} to CHANNEL_IDS to enable replies.`
            );
          }
          return;
        }
      }

      try {
        // Ensure messageManager exists
        this.messageManager?.handleMessage(message);
      } catch (error) {
        this.runtime.logger.error(`Error handling message: ${error}`);
      }
    });

    // Setup handling for reactions
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.id === this.client?.user?.id) {
        return;
      }
      // Skip if channel restrictions are set and this reaction is not in an allowed channel
      if (
        this.allowedChannelIds &&
        reaction.message.channel &&
        !this.isChannelAllowed(reaction.message.channel.id)
      ) {
        return;
      }
      try {
        await this.handleReactionAdd(reaction, user);
      } catch (error) {
        this.runtime.logger.error(`Error handling reaction add: ${error}`);
      }
    });

    // Handle reaction removal
    this.client.on('messageReactionRemove', async (reaction, user) => {
      if (user.id === this.client?.user?.id) {
        return;
      }
      // Skip if channel restrictions are set and this reaction is not in an allowed channel
      if (
        this.allowedChannelIds &&
        reaction.message.channel &&
        !this.isChannelAllowed(reaction.message.channel.id)
      ) {
        return;
      }
      try {
        await this.handleReactionRemove(reaction, user);
      } catch (error) {
        this.runtime.logger.error(`Error handling reaction remove: ${error}`);
      }
    });

    // Setup guild (server) event handlers
    this.client.on('guildCreate', async (guild) => {
      try {
        await this.handleGuildCreate(guild);
      } catch (error) {
        this.runtime.logger.error(`Error handling guild create: ${error}`);
      }
    });

    // Setup member (user) joining handlers
    this.client.on('guildMemberAdd', async (member) => {
      try {
        await this.handleGuildMemberAdd(member);
      } catch (error) {
        this.runtime.logger.error(`Error handling guild member add: ${error}`);
      }
    });

    // Interaction handlers
    this.client.on('interactionCreate', async (interaction) => {
      // Skip if channel restrictions are set and this interaction is not in an allowed channel
      if (
        this.allowedChannelIds &&
        interaction.channelId &&
        !this.isChannelAllowed(interaction.channelId)
      ) {
        return;
      }
      try {
        await this.handleInteractionCreate(interaction);
      } catch (error) {
        this.runtime.logger.error(`Error handling interaction: ${error}`);
      }
    });

    this.client.on('userStream', (entityId, name, userName, channel, opusDecoder) => {
      if (entityId !== this.client?.user?.id) {
        // Ensure voiceManager exists
        this.voiceManager?.handleUserStream(entityId, name, userName, channel, opusDecoder);
      }
    });
  }

  /**
   * Handles the event when a new member joins a guild.
   *
   * @param {GuildMember} member - The GuildMember object representing the new member that joined the guild.
   * @returns {Promise<void>} - A Promise that resolves once the event handling is complete.
   * @private
   */
  private async handleGuildMemberAdd(member: GuildMember) {
    this.runtime.logger.log(`New member joined: ${member.user.username}`);

    const guild = member.guild;

    const tag = member.user.bot
      ? `${member.user.username}#${member.user.discriminator}`
      : member.user.username;

    const worldId = createUniqueUuid(this.runtime, guild.id);
    const entityId = createUniqueUuid(this.runtime, member.id);

    // Emit standardized ENTITY_JOINED event
    this.runtime.emitEvent([EventType.ENTITY_JOINED], {
      runtime: this.runtime,
      entityId,
      worldId,
      source: 'discord',
      metadata: {
        originalId: member.id,
        username: tag,
        displayName: member.displayName || member.user.username,
        roles: member.roles.cache.map((r) => r.name),
        joinedAt: member.joinedAt?.getTime(),
      },
    });

    // Emit Discord-specific event
    this.runtime.emitEvent([DiscordEventTypes.ENTITY_JOINED], {
      runtime: this.runtime,
      entityId,
      worldId,
      member,
      guild,
    });
  }

  /**
   * Handles the event when the bot joins a guild. It logs the guild name, fetches additional information about the guild, scans the guild for voice data, creates standardized world data structure, generates unique IDs, and emits events to the runtime.
   * @param {Guild} guild - The guild that the bot has joined.
   * @returns {Promise<void>} A promise that resolves when the guild creation is handled.
   * @private
   */
  private async handleGuildCreate(guild: Guild) {
    this.runtime.logger.log(`Joined guild ${guild.name}`);
    const fullGuild = await guild.fetch();
    // Disabled automatic voice joining - now controlled by joinVoiceChannel action
    // this.voiceManager?.scanGuild(guild);

    const ownerId = createUniqueUuid(this.runtime, fullGuild.ownerId);

    // Create standardized world data structure
    const worldId = createUniqueUuid(this.runtime, fullGuild.id);
    const standardizedData = {
      runtime: this.runtime,
      rooms: await this.buildStandardizedRooms(fullGuild, worldId),
      users: await this.buildStandardizedUsers(fullGuild),
      world: {
        id: worldId,
        name: fullGuild.name,
        agentId: this.runtime.agentId,
        serverId: fullGuild.id,
        metadata: {
          ownership: fullGuild.ownerId ? { ownerId: ownerId } : undefined,
          roles: {
            [ownerId]: Role.OWNER,
          },
        },
      } as World,
      source: 'discord',
    };

    // Emit both Discord-specific and standardized events with the same data structure
    this.runtime.emitEvent([DiscordEventTypes.WORLD_JOINED], {
      runtime: this.runtime,
      server: fullGuild,
      source: 'discord',
    });

    // Emit standardized event with the same structure as WORLD_CONNECTED
    this.runtime.emitEvent([EventType.WORLD_JOINED], standardizedData);
  }

  /**
   * Handles interactions created by the user, specifically commands and message components.
   * @param {Interaction} interaction - The interaction object received.
   * @returns {Promise<void>} A promise that resolves when the interaction is handled.
   * @private
   */
  private async handleInteractionCreate(interaction: Interaction) {
    if (interaction.isCommand()) {
      switch (interaction.commandName) {
        case 'start':
          // acknowledge it so it doesn't time out
          await interaction.deferReply(); // can't editReply unless we await
          this.runtime.emitEvent([DiscordEventTypes.SLASH_START], {
            interaction,
            client: this.client,
          });
          break;
        case 'joinchannel':
          // Ensure voiceManager exists
          await this.voiceManager?.handleJoinChannelCommand(interaction);
          break;
        case 'leavechannel':
          // Ensure voiceManager exists
          await this.voiceManager?.handleLeaveChannelCommand(interaction);
          break;
      }
    }

    // Handle message component interactions (buttons, dropdowns, etc.)
    if (interaction.isMessageComponent()) {
      this.runtime.logger.info(`Received component interaction: ${interaction.customId}`);
      const userId = interaction.user?.id;
      const messageId = interaction.message?.id;

      // Initialize user's selections if not exists
      if (!this.userSelections.has(userId)) {
        this.userSelections.set(userId, {});
      }
      const userSelections = this.userSelections.get(userId);
      if (!userSelections) {
        this.runtime.logger.error(`User selections map unexpectedly missing for user ${userId}`);
        return; // Should not happen
      }

      try {
        // For select menus (type 3), store the values
        if (interaction.isStringSelectMenu()) {
          this.runtime.logger.info(`Values selected: ${JSON.stringify(interaction.values)}`);
          this.runtime.logger.info(
            `User ${userId} selected values for ${interaction.customId}: ${JSON.stringify(interaction.values)}`
          );

          // Store values with messageId to scope them to this specific form
          userSelections[messageId] = {
            ...userSelections[messageId],
            [interaction.customId]: interaction.values,
          };
          // No need to call set again, modification is in place

          // Log the current state of all selections for this message
          this.runtime.logger.info(
            `Current selections for message ${messageId}: ${JSON.stringify(userSelections[messageId])}`
          );

          // Acknowledge the selection
          await interaction.deferUpdate();
          // await interaction.followUp({
          //   content: 'Selection saved!',
          //   ephemeral: true,
          // });
        }

        // For button interactions (type 2), use stored values
        if (interaction.isButton()) {
          this.runtime.logger.info('Button interaction detected');
          this.runtime.logger.info(`Button pressed by user ${userId}: ${interaction.customId}`);
          const formSelections = userSelections[messageId] || {};

          this.runtime.logger.info(`Form data being submitted: ${JSON.stringify(formSelections)}`);

          // Emit an event with the interaction data and stored selections
          this.runtime.emitEvent(['DISCORD_INTERACTION'], {
            interaction: {
              customId: interaction.customId,
              componentType: interaction.componentType,
              type: interaction.type,
              user: userId,
              messageId: messageId,
              selections: formSelections,
            },
            source: 'discord',
          });

          // Clear selections for this form only
          delete userSelections[messageId];
          // No need to call set again
          this.runtime.logger.info(`Cleared selections for message ${messageId}`);

          // Acknowledge the button press
          await interaction.deferUpdate();
          await interaction.followUp({
            content: 'Form submitted successfully!',
            ephemeral: true,
          });
        }
      } catch (error) {
        this.runtime.logger.error(`Error handling component interaction: ${error}`);
        try {
          await interaction.followUp({
            content: 'There was an error processing your interaction.',
            ephemeral: true,
          });
        } catch (followUpError) {
          this.runtime.logger.error(`Error sending follow-up message: ${followUpError}`);
        }
      }
    }
  }

  /**
   * Builds a standardized list of rooms from Discord guild channels.
   *
   * @param {Guild} guild The guild to build rooms for.
   * @param {UUID} _worldId The ID of the world to associate with the rooms (currently unused in favor of direct channel to room mapping).
   * @returns {Promise<any[]>} An array of standardized room objects.
   * @private
   */
  private async buildStandardizedRooms(guild: Guild, _worldId: UUID): Promise<any[]> {
    const rooms: any[] = [];

    for (const [channelId, channel] of guild.channels.cache) {
      // Only process text and voice channels
      if (
        channel.type === DiscordChannelType.GuildText ||
        channel.type === DiscordChannelType.GuildVoice
      ) {
        const roomId = createUniqueUuid(this.runtime, channelId);
        let channelType;

        switch (channel.type) {
          case DiscordChannelType.GuildText:
            channelType = ChannelType.GROUP;
            break;
          case DiscordChannelType.GuildVoice:
            channelType = ChannelType.VOICE_GROUP;
            break;
          default:
            channelType = ChannelType.GROUP;
        }

        // For text channels, we could potentially get member permissions
        // But for performance reasons, keep this light for large guilds
        let participants: UUID[] = [];

        if (guild.memberCount < 1000 && channel.type === DiscordChannelType.GuildText) {
          try {
            // Only attempt this for smaller guilds
            // Get members with read permissions for this channel
            participants = Array.from(guild.members.cache.values())
              .filter((member) =>
                channel.permissionsFor(member)?.has(PermissionsBitField.Flags.ViewChannel)
              )
              .map((member) => createUniqueUuid(this.runtime, member.id));
          } catch (error) {
            this.runtime.logger.warn(
              `Failed to get participants for channel ${channel.name}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        rooms.push({
          id: roomId,
          name: channel.name,
          type: channelType,
          channelId: channel.id,
          participants,
        });
      }
    }

    return rooms;
  }

  /**
   * Builds a standardized list of users (entities) from Discord guild members.
   * Implements different strategies based on guild size for performance.
   *
   * @param {Guild} guild - The guild from which to build the user list.
   * @returns {Promise<Entity[]>} A promise that resolves with an array of standardized entity objects.
   * @private
   */
  private async buildStandardizedUsers(guild: Guild): Promise<Entity[]> {
    const entities: Entity[] = [];
    const botId = this.client?.user?.id;

    // Strategy based on guild size
    if (guild.memberCount > 1000) {
      this.runtime.logger.info(
        `Using optimized user sync for large guild ${guild.name} (${guild.memberCount.toLocaleString()} members)`
      );

      // For large guilds, prioritize members already in cache + online members
      try {
        // Use cache first
        for (const [, member] of guild.members.cache) {
          const tag = member.user.bot
            ? `${member.user.username}#${member.user.discriminator}`
            : member.user.username;

          if (member.id !== botId) {
            entities.push({
              id: createUniqueUuid(this.runtime, member.id),
              names: Array.from(
                new Set(
                  [member.user.username, member.displayName, member.user.globalName].filter(
                    Boolean
                  ) as string[]
                )
              ),
              agentId: this.runtime.agentId,
              metadata: {
                default: {
                  username: tag,
                  name: member.displayName || member.user.username,
                },
                discord: member.user.globalName
                  ? {
                      username: tag,
                      name: member.displayName || member.user.username,
                      globalName: member.user.globalName,
                      userId: member.id,
                    }
                  : {
                      username: tag,
                      name: member.displayName || member.user.username,
                      userId: member.id,
                    },
              },
            });
          }
        }

        // If cache has very few members, try to get online members
        if (entities.length < 100) {
          this.runtime.logger.info(`Adding online members for ${guild.name}`);
          // This is a more targeted fetch that is less likely to hit rate limits
          const onlineMembers = await guild.members.fetch({ limit: 100 });

          for (const [, member] of onlineMembers) {
            if (member.id !== botId) {
              const entityId = createUniqueUuid(this.runtime, member.id);
              // Avoid duplicates
              if (!entities.some((u) => u.id === entityId)) {
                const tag = member.user.bot
                  ? `${member.user.username}#${member.user.discriminator}`
                  : member.user.username;

                entities.push({
                  id: entityId,
                  names: Array.from(
                    new Set(
                      [member.user.username, member.displayName, member.user.globalName].filter(
                        Boolean
                      ) as string[]
                    )
                  ),
                  agentId: this.runtime.agentId,
                  metadata: {
                    default: {
                      username: tag,
                      name: member.displayName || member.user.username,
                    },
                    discord: member.user.globalName
                      ? {
                          username: tag,
                          name: member.displayName || member.user.username,
                          globalName: member.user.globalName,
                          userId: member.id,
                        }
                      : {
                          username: tag,
                          name: member.displayName || member.user.username,
                          userId: member.id,
                        },
                  },
                });
              }
            }
          }
        }
      } catch (error) {
        this.runtime.logger.error(`Error fetching members for ${guild.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // For smaller guilds, we can fetch all members
      try {
        let members = guild.members.cache;
        if (members.size === 0) {
          members = await guild.members.fetch();
        }

        for (const [, member] of members) {
          if (member.id !== botId) {
            const tag = member.user.bot
              ? `${member.user.username}#${member.user.discriminator}`
              : member.user.username;

            entities.push({
              id: createUniqueUuid(this.runtime, member.id),
              names: Array.from(
                new Set(
                  [member.user.username, member.displayName, member.user.globalName].filter(
                    Boolean
                  ) as string[]
                )
              ),
              agentId: this.runtime.agentId,
              metadata: {
                default: {
                  username: tag,
                  name: member.displayName || member.user.username,
                },
                discord: member.user.globalName
                  ? {
                      username: tag,
                      name: member.displayName || member.user.username,
                      globalName: member.user.globalName,
                      userId: member.id,
                    }
                  : {
                      username: tag,
                      name: member.displayName || member.user.username,
                      userId: member.id,
                    },
              },
            });
          }
        }
      } catch (error) {
        this.runtime.logger.error(`Error fetching members for ${guild.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return entities;
  }

  /**
   * Handles tasks to be performed once the Discord client is fully ready and connected.
   * This includes fetching guilds, scanning for voice data, and emitting connection events.
   * @private
   * @returns {Promise<void>} A promise that resolves when all on-ready tasks are completed.
   */
  private async onReady(readyClient) {
    this.runtime.logger.success('DISCORD ON READY');

    // Register slash commands
    const commands = [
      {
        name: 'start',
        description: 'Perhaps get bot information',
      },
      // actions control access better
      /*
        {
            name: "joinchannel",
            description: "Join a voice channel",
            options: [
                {
                    name: "channel",
                    type: 7, // CHANNEL type
                    description: "The voice channel to join",
                    required: true,
                    channel_types: [2], // GuildVoice type
                },
            ],
        },
        {
            name: "leavechannel",
            description: "Leave the current voice channel",
        },
        */
    ];
    try {
      if (this.client?.application) {
        // has 1 hour cache delay
        await this.client.application.commands.set(commands);
      }
      this.runtime.logger.success('Slash commands registered');
    } catch (error) {
      console.error('Error registering slash commands:', error);
    }

    // Required permissions for the bot
    const requiredPermissions = [
      // Text Permissions
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.SendMessagesInThreads,
      PermissionsBitField.Flags.CreatePrivateThreads,
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.EmbedLinks,
      PermissionsBitField.Flags.AttachFiles,
      PermissionsBitField.Flags.AddReactions,
      PermissionsBitField.Flags.UseExternalEmojis,
      PermissionsBitField.Flags.UseExternalStickers,
      PermissionsBitField.Flags.MentionEveryone,
      PermissionsBitField.Flags.ManageMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
      // Voice Permissions
      PermissionsBitField.Flags.Connect,
      PermissionsBitField.Flags.Speak,
      PermissionsBitField.Flags.UseVAD,
      PermissionsBitField.Flags.PrioritySpeaker,
    ].reduce((a, b) => a | b, 0n);

    this.runtime.logger.log('Use this URL to add the bot to your server:');
    this.runtime.logger.log(
      `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user?.id}&permissions=${requiredPermissions}&scope=bot%20applications.commands`
    );

    const guilds = await this.client?.guilds.fetch();
    if (!guilds) {
      this.runtime.logger.warn('Could not fetch guilds, client might not be ready.');
      return;
    }
    for (const [, guild] of guilds) {
      const fullGuild = await guild.fetch();

      // accelerate updating commands
      await fullGuild.commands.set(commands);

      // Disabled automatic voice joining - now controlled by joinVoiceChannel action
      // await this.voiceManager?.scanGuild(fullGuild);

      // Send after a brief delay
      const timeoutId = setTimeout(async () => {
        // For each server the client is in, fire a connected event
        try {
          const fullGuild = await guild.fetch();
          this.runtime.logger.log('DISCORD SERVER CONNECTED', fullGuild.name);

          // Emit Discord-specific event with full guild object
          this.runtime.emitEvent([DiscordEventTypes.WORLD_CONNECTED], {
            runtime: this.runtime,
            server: fullGuild,
            source: 'discord',
          });

          // Create platform-agnostic world data structure with simplified structure
          const worldId = createUniqueUuid(this.runtime, fullGuild.id);
          const ownerId = createUniqueUuid(this.runtime, fullGuild.ownerId);

          const standardizedData = {
            name: fullGuild.name,
            runtime: this.runtime,
            rooms: await this.buildStandardizedRooms(fullGuild, worldId),
            entities: await this.buildStandardizedUsers(fullGuild),
            world: {
              id: worldId,
              name: fullGuild.name,
              agentId: this.runtime.agentId,
              serverId: fullGuild.id,
              metadata: {
                ownership: fullGuild.ownerId ? { ownerId } : undefined,
                roles: {
                  [ownerId]: Role.OWNER,
                },
              },
            } as World,
            source: 'discord',
          };

          // Emit standardized event
          this.runtime.emitEvent([EventType.WORLD_CONNECTED], standardizedData);
        } catch (error) {
          // Add error handling to prevent crashes if the client is already destroyed
          this.runtime.logger.error(`Error during Discord world connection: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, 1000);

      // Store the timeout reference to be able to cancel it when stopping
      this.timeouts.push(timeoutId);
    }

    this.client?.emit('voiceManagerReady');
  }

  /**
   * Registers send handlers for the Discord service instance.
   * This allows the runtime to correctly dispatch messages to this service.
   * @param {IAgentRuntime} runtime - The agent runtime instance.
   * @param {DiscordService} serviceInstance - The instance of the DiscordService.
   * @static
   */
  static registerSendHandlers(runtime: IAgentRuntime, serviceInstance: DiscordService) {
    if (serviceInstance) {
      runtime.registerSendHandler(
        'discord',
        serviceInstance.handleSendMessage.bind(serviceInstance)
      );
      runtime.logger.info('[Discord] Registered send handler.');
    }
  }

  /**
   * Fetches all members who have access to a specific text channel.
   *
   * @param {string} channelId - The Discord ID of the text channel.
   * @param {boolean} [useCache=true] - Whether to prioritize cached data. Defaults to true.
   * @returns {Promise<Array<{id: string, username: string, displayName: string}>>} A promise that resolves with an array of channel member objects, each containing id, username, and displayName.
   */
  public async getTextChannelMembers(
    channelId: string,
    useCache: boolean = true
  ): Promise<Array<{ id: string; username: string; displayName: string }>> {
    this.runtime.logger.info(
      `Fetching members for text channel ${channelId}, useCache=${useCache}`
    );

    try {
      // Fetch the channel
      const channel = (await this.client?.channels.fetch(channelId)) as TextChannel;

      // Validate channel
      if (!channel) {
        this.runtime.logger.error(`Channel not found: ${channelId}`);
        return [];
      }

      if (channel.type !== DiscordChannelType.GuildText) {
        this.runtime.logger.error(`Channel ${channelId} is not a text channel`);
        return [];
      }

      const guild = channel.guild;
      if (!guild) {
        this.runtime.logger.error(`Channel ${channelId} is not in a guild`);
        return [];
      }

      // Determine strategy based on guild size and cache preference
      const useCacheOnly = useCache && guild.memberCount > 1000;
      let members: Collection<string, GuildMember>;

      if (useCacheOnly) {
        this.runtime.logger.info(
          `Using cached members for large guild ${guild.name} (${guild.memberCount} members)`
        );
        members = guild.members.cache;
      } else {
        // For smaller guilds or when cache is not preferred, fetch members
        try {
          if (useCache && guild.members.cache.size > 0) {
            this.runtime.logger.info(`Using cached members (${guild.members.cache.size} members)`);
            members = guild.members.cache;
          } else {
            this.runtime.logger.info(`Fetching members for guild ${guild.name}`);
            members = await guild.members.fetch();
            logger.info(`Fetched ${members.size} members`);
          }
        } catch (error) {
          this.runtime.logger.error(`Error fetching members: ${error}`);
          // Fallback to cache if fetch fails
          members = guild.members.cache;
          this.runtime.logger.info(`Fallback to cache with ${members.size} members`);
        }
      }

      // Filter members by permission to view the channel
      this.runtime.logger.info(`Filtering members for access to channel ${channel.name}`);
      // Explicitly type the array from values()
      const memberArray: GuildMember[] = Array.from(members.values());
      const channelMembers = memberArray
        .filter((member: GuildMember) => {
          // Skip bots except our own bot
          // Add null check for client and client.user
          if (member.user.bot && member.id !== this.client?.user?.id) {
            return false;
          }

          // Check if the member can view the channel
          return (
            channel.permissionsFor(member)?.has(PermissionsBitField.Flags.ViewChannel) ?? false
          );
        })
        .map((member: GuildMember) => ({
          id: member.id,
          username: member.user.username,
          displayName: member.displayName || member.user.username,
        }));

      this.runtime.logger.info(
        `Found ${channelMembers.length} members with access to channel ${channel.name}`
      );
      return channelMembers;
    } catch (error) {
      this.runtime.logger.error(`Error fetching channel members: ${error}`);
      return [];
    }
  }

  /**
   * Placeholder for handling reaction addition.
   * @private
   */
  private async handleReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ) {
    try {
      this.runtime.logger.log('Reaction added');

      // Early returns
      if (!reaction || !user) {
        this.runtime.logger.warn('Invalid reaction or user');
        return;
      }

      // Get emoji info
      let emoji = reaction.emoji.name;
      if (!emoji && reaction.emoji.id) {
        emoji = `<:${reaction.emoji.name}:${reaction.emoji.id}>`;
      }

      // Fetch full message if partial
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          this.runtime.logger.error(`Failed to fetch partial reaction: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
      }

      // Generate IDs with timestamp to ensure uniqueness
      const timestamp = Date.now();
      const roomId = createUniqueUuid(this.runtime, reaction.message.channel.id);
      const entityId = createUniqueUuid(this.runtime, user.id);
      const reactionUUID = createUniqueUuid(
        this.runtime,
        `${reaction.message.id}-${user.id}-${emoji}-${timestamp}`
      );

      // Validate IDs
      if (!entityId || !roomId) {
        this.runtime.logger.error(`Invalid user ID or room ID: ${entityId} ${roomId}`);
        return;
      }

      // Process message content
      const messageContent = reaction.message.content || '';
      const truncatedContent =
        messageContent.length > 50 ? `${messageContent.substring(0, 50)}...` : messageContent;
      const reactionMessage = `*Added <${emoji}> to: \\"${truncatedContent}\\"*`; // Escaped quotes

      // Get user info
      const userName = reaction.message.author?.username || 'unknown';
      const name = reaction.message.author?.displayName || userName;

      await this.runtime.ensureConnection({
        entityId,
        roomId,
        userName,
        worldId: createUniqueUuid(this.runtime, reaction.message.guild?.id ?? roomId) as UUID,
        worldName: reaction.message.guild?.name,
        name: name,
        source: 'discord',
        channelId: reaction.message.channel.id,
        serverId: reaction.message.guild?.id,
        type: await this.getChannelType(reaction.message.channel as Channel),
      });

      const inReplyTo = createUniqueUuid(this.runtime, reaction.message.id);

      const memory: Memory = {
        id: reactionUUID,
        entityId,
        agentId: this.runtime.agentId,
        content: {
          // name,
          // userName,
          text: reactionMessage,
          source: 'discord',
          inReplyTo,
          channelType: await this.getChannelType(reaction.message.channel as Channel),
        },
        roomId,
        createdAt: timestamp,
      };

      const callback: HandlerCallback = async (content): Promise<Memory[]> => {
        if (!reaction.message.channel) {
          this.runtime.logger.error('No channel found for reaction message');
          return [];
        }
        await (reaction.message.channel as TextChannel).send(content.text ?? '');
        return [];
      };

      this.runtime.emitEvent(['DISCORD_REACTION_RECEIVED', 'REACTION_RECEIVED'], {
        runtime: this.runtime,
        message: memory,
        callback,
      });
    } catch (error) {
      this.runtime.logger.error(`Error handling reaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Placeholder for handling reaction removal.
   * @private
   */
  private async handleReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ) {
    try {
      this.runtime.logger.log('Reaction removed');

      let emoji = reaction.emoji.name;
      if (!emoji && reaction.emoji.id) {
        emoji = `<:${reaction.emoji.name}:${reaction.emoji.id}>`;
      }

      // Fetch the full message if it's a partial
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          this.runtime.logger.error(`Something went wrong when fetching the message: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
      }

      const messageContent = reaction.message.content || '';
      const truncatedContent =
        messageContent.length > 50 ? `${messageContent.substring(0, 50)}...` : messageContent;

      const reactionMessage = `*Removed <${emoji}> from: \\"${truncatedContent}\\"*`; // Escaped quotes

      const roomId = createUniqueUuid(this.runtime, reaction.message.channel.id);

      const entityId = createUniqueUuid(this.runtime, user.id);
      const timestamp = Date.now();
      const reactionUUID = createUniqueUuid(
        this.runtime,
        `${reaction.message.id}-${user.id}-${emoji}-${timestamp}`
      );

      const userName = reaction.message.author?.username || 'unknown';
      const name = reaction.message.author?.displayName || userName;

      await this.runtime.ensureConnection({
        entityId,
        roomId,
        userName,
        worldId: createUniqueUuid(this.runtime, reaction.message.guild?.id ?? roomId) as UUID,
        worldName: reaction.message.guild?.name,
        name: name,
        source: 'discord',
        channelId: reaction.message.channel.id,
        serverId: reaction.message.guild?.id,
        type: await this.getChannelType(reaction.message.channel as Channel),
      });

      const memory: Memory = {
        id: reactionUUID,
        entityId,
        agentId: this.runtime.agentId,
        content: {
          // name,
          // userName,
          text: reactionMessage,
          source: 'discord',
          inReplyTo: createUniqueUuid(this.runtime, reaction.message.id),
          channelType: await this.getChannelType(reaction.message.channel as Channel),
        },
        roomId,
        createdAt: Date.now(),
      };

      const callback: HandlerCallback = async (content): Promise<Memory[]> => {
        if (!reaction.message.channel) {
          this.runtime.logger.error('No channel found for reaction message');
          return [];
        }
        await (reaction.message.channel as TextChannel).send(content.text ?? '');
        return [];
      };

      this.runtime.emitEvent([DiscordEventTypes.REACTION_RECEIVED], {
        runtime: this.runtime,
        message: memory,
        callback,
      });
    } catch (error) {
      this.runtime.logger.error(`Error handling reaction removal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Checks if a channel ID is allowed based on both env config and dynamic additions.
   * @param {string} channelId - The channel ID to check
   * @returns {boolean} Whether the channel is allowed
   */
  public isChannelAllowed(channelId: string): boolean {
    // If no restrictions are set, allow all channels
    if (!this.allowedChannelIds) {
      return true;
    }

    // Check if channel is in the env-configured list or dynamically added
    return this.allowedChannelIds.includes(channelId) || this.dynamicChannelIds.has(channelId);
  }

  /**
   * Adds a channel to the dynamic allowed list.
   * @param {string} channelId - The channel ID to add
   * @returns {boolean} Whether the channel was successfully added
   */
  public addAllowedChannel(channelId: string): boolean {
    // Validate the channel exists
    if (!this.client?.channels.cache.has(channelId)) {
      return false;
    }

    this.dynamicChannelIds.add(channelId);
    return true;
  }

  /**
   * Removes a channel from the dynamic allowed list.
   * @param {string} channelId - The channel ID to remove
   * @returns {boolean} Whether the channel was in the list and removed
   */
  public removeAllowedChannel(channelId: string): boolean {
    // Don't allow removing channels that are in the env config
    if (this.allowedChannelIds?.includes(channelId)) {
      return false;
    }

    return this.dynamicChannelIds.delete(channelId);
  }

  /**
   * Gets the list of all allowed channels (env + dynamic).
   * @returns {string[]} Array of allowed channel IDs
   */
  public getAllowedChannels(): string[] {
    const envChannels = this.allowedChannelIds || [];
    const dynamicChannels = Array.from(this.dynamicChannelIds);
    return [...new Set([...envChannels, ...dynamicChannels])];
  }

  /**
   * Stops the Discord service and cleans up resources.
   * Implements the abstract method from the Service class.
   */
  public async stop(): Promise<void> {
    this.runtime.logger.info('Stopping Discord service...');
    this.timeouts.forEach(clearTimeout); // Clear any pending timeouts
    this.timeouts = [];
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.runtime.logger.info('Discord client destroyed.');
    }
    // Additional cleanup if needed (e.g., voice manager)
    if (this.voiceManager) {
      // Assuming voiceManager has a stop or cleanup method
      // await this.voiceManager.stop();
    }
    this.runtime.logger.info('Discord service stopped.');
  }

  /**
   * Asynchronously retrieves the type of a given channel.
   *
   * @param {Channel} channel - The channel for which to determine the type.
   * @returns {Promise<ChannelType>} A Promise that resolves with the type of the channel.
   */
  async getChannelType(channel: Channel): Promise<ChannelType> {
    switch (channel.type) {
      case DiscordChannelType.DM:
        return ChannelType.DM;
      case DiscordChannelType.GuildText:
        return ChannelType.GROUP;
      case DiscordChannelType.GuildVoice:
        return ChannelType.VOICE_GROUP;
      default:
        // Fallback or handle other channel types as needed
        this.runtime.logger.warn(`Discord unhandled channel type: ${channel.type}`);
        return ChannelType.GROUP;
    }
  }
}

export default DiscordService;
