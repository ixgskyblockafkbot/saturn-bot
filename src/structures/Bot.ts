import type { AudioPlayer } from '@discordjs/voice';
import {
  Client,
  Collection,
  GatewayIntentBits,
  type CommandInteraction,
  type Snowflake
} from 'discord.js';

import config from '@/config';
import {
  APP_COMMANDS_LOADED,
  APP_COMMAND_ERROR_DESCRIPTION,
  APP_COMMAND_ERROR_TITLE,
  APP_ERROR_COLOR,
  APP_MISSING_REQUIRED_CREDENTIALS,
  APP_READY
} from '@/constants';
import { InvalidAppCommandError } from '@/errors/InvalidAppCommandError';
import { MissingRequiredCredentialsError } from '@/errors/MissingRequiredCredentialsError';
import { UncaughtExceptionMonitorError } from '@/errors/UncaughtExceptionMonitorError';
import { UnhandledPromiseRejectionError } from '@/errors/UnhandledPromiseRejectionError';
import { AppErrorHandler } from '@/handlers/AppErrorHandler';
import { CommandsHandler } from '@/handlers/CommandsHandler';
import { MessageChannelHandler } from '@/handlers/MessageChannelHandler';
import { MusicPlaybackHandler } from '@/handlers/MusicPlaybackHandler';
import { PrismaClient } from '@/infra/PrismaClient';

import type { Command } from './Command';
import { Embed } from './Embed';

export class Bot extends Client {
  private static INSTANCE: Bot;
  databaseClient!: PrismaClient;
  appErrorHandler!: AppErrorHandler;
  musicPlaybackHandler!: MusicPlaybackHandler;
  messageChannelHandler!: MessageChannelHandler;
  commands!: Collection<Snowflake, Command>;
  subscriptions!: Map<Snowflake, AudioPlayer>;

  private constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
      ]
    });
    this.validateRequiredCredentials();
    this.maybeMakeDatabaseConnection();
    this.onCreateInteraction();
    this.onListeningInteraction();
    this.makeDiscordAPIConnection();
  }

  static getInstance() {
    if (!this.INSTANCE) this.INSTANCE = new Bot();
    return this.INSTANCE;
  }

  private validateRequiredCredentials() {
    const { botToken, botAppId, guildId } = config;

    if (!botToken || !botAppId || !guildId) {
      throw new MissingRequiredCredentialsError(
        APP_MISSING_REQUIRED_CREDENTIALS
      );
    }
  }

  private async maybeMakeDatabaseConnection() {
    this.databaseClient = PrismaClient.getInstance();
    await this.databaseClient.createConnection();

    this.appErrorHandler = AppErrorHandler.getInstance(this);
  }

  private async onCreateInteraction() {
    this.commands = new Collection();
    this.subscriptions = new Map();
    const isCommandsLoaded = await new CommandsHandler(this).loadCommands();
    if (isCommandsLoaded) console.log(APP_COMMANDS_LOADED);

    this.once('ready', () => console.log(APP_READY));

    process.on(
      'unhandledRejection',
      ({ message }: Error) =>
        new UnhandledPromiseRejectionError({ message, bot: this })
    );
    process.on(
      'uncaughtExceptionMonitor',
      ({ message }: Error) =>
        new UncaughtExceptionMonitorError({ message, bot: this })
    );
  }

  private onListeningInteraction() {
    this.on('interactionCreate', async (interaction) => {
      this.musicPlaybackHandler = MusicPlaybackHandler.getInstance(
        this,
        interaction as CommandInteraction
      );
      this.messageChannelHandler =
        MessageChannelHandler.getInstance(interaction);
      const embed = Embed.getInstance();

      this.user?.setActivity(`Orbiting in ${interaction.guild?.name}`);

      if (!interaction.isChatInputCommand()) return;

      try {
        await interaction.deferReply();

        console.log(
          `\n> @${interaction.user.tag} triggered "${interaction.commandName}" command.`
        );

        const command = this.commands.get(interaction.commandName);

        if (!command)
          throw new InvalidAppCommandError({
            message: `${interaction.commandName} is not a valid command.`,
            bot: this,
            interaction
          });

        await command.execute(interaction);
      } catch (e) {
        console.error(e);

        embed.build(interaction, {
          author: {
            name: APP_COMMAND_ERROR_TITLE
          },
          description: APP_COMMAND_ERROR_DESCRIPTION,
          color: APP_ERROR_COLOR
        });
      }
    });
  }

  private async makeDiscordAPIConnection() {
    try {
      await this.login(config.botToken);
    } catch (e) {
      console.error(e);
    }
  }
}
