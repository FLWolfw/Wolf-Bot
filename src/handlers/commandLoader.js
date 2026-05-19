import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Collection } from 'discord.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getSubcommandInfo(commandData) {
    const subcommands = [];
    
    if (commandData.options) {
        for (const option of commandData.options) {
            if (option.type === 1) {
                subcommands.push(option.name);
            } else if (option.type === 2) {
                if (option.options) {
                    for (const subOption of option.options) {
                        if (subOption.type === 1) {
                            subcommands.push(`${option.name}/${subOption.name}`);
                        }
                    }
                }
            }
        }
    }
    
    return subcommands;
}

async function getAllFiles(directory, fileList = []) {
    const files = await fs.readdir(directory, { withFileTypes: true });
    
    for (const file of files) {
        const filePath = path.join(directory, file.name);
        
        if (file.isDirectory()) {
            if (file.name === 'modules') {
                continue;
            }
            await getAllFiles(filePath, fileList);
        } else if (file.name.endsWith('.js')) {
            fileList.push(filePath);
        }
    }
    
    return fileList;
}

export async function loadCommands(client) {
    client.commands = new Collection();
    const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = await getAllFiles(commandsPath);
    
    logger.info(`Found ${commandFiles.length} command files to load`);
    
    const uniqueCommandNames = new Set();
    
    for (const filePath of commandFiles) {
        try {
            const normalizedPath = filePath.replace(/\\/g, '/');
            
            const commandName = path.basename(filePath, '.js');
            const commandDir = path.dirname(filePath);
            const category = path.basename(commandDir);
            
            const commandModule = await import(`file://${filePath}`);
            const command = commandModule.default || commandModule;
            
            if (!command.data || !command.execute) {
                logger.warn(`Command at ${filePath} is missing required "data" or "execute" property.`);
                continue;
            }
            
            command.category = category;
            command.filePath = normalizedPath;
            
            const primaryCommandName = command.data.name;
            
            if (!uniqueCommandNames.has(primaryCommandName)) {
                uniqueCommandNames.add(primaryCommandName);
                client.commands.set(primaryCommandName, command);
            }
            
            const subcommands = getSubcommandInfo(command.data.toJSON());
            
            logger.info(`Loaded command: ${primaryCommandName} from ${normalizedPath} (category: ${category})`);
            
            if (subcommands.length > 0) {
                logger.info(`  - Subcommands: ${subcommands.join(', ')}`);
            }
            
        } catch (error) {
            logger.error(`Error loading command from ${filePath}:`, error);
        }
    }
    
    const uniqueCommands = new Set();
    for (const [name, command] of client.commands.entries()) {
        if (command.data && command.data.name) {
            uniqueCommands.add(command.data.name);
        }
    }
    
    logger.info(`Loaded ${uniqueCommands.size} commands`);
    return client.commands;
}

export async function registerCommands(client, guildId) {
    try {
        const commands = [];
        let totalSubcommands = 0;
        const registeredNames = new Set();
        
        for (const command of client.commands.values()) {
            if (command.data && typeof command.data.toJSON === 'function') {
                const commandName = command.data.name;
                
                logger.debug(`Processing command for registration: ${commandName}`);
                
                if (!registeredNames.has(commandName)) {
                    registeredNames.add(commandName);
                    const commandJson = command.data.toJSON();
                    commands.push(commandJson);
                    
                    const subcommands = getSubcommandInfo(commandJson);
                    totalSubcommands += subcommands.length;
                    
                    if (process.env.NODE_ENV !== 'production') {
                        logger.debug(`Registering command: ${commandName}`);
                    }
                } else {
                    logger.debug(`Skipping duplicate command: ${commandName}`);
                }
            } else {
                logger.warn(`Command missing data or toJSON method: ${command}`);
            }
        }
        
        const totalCommandsWithSubs = commands.length + totalSubcommands;
        
        if (guildId) {
            logger.info(`Preparing to register ${totalCommandsWithSubs} commands for guild ${guildId}`);
            logger.info('Validating commands before registration...');
            
            let validationErrors = [];
            commands.forEach((cmd) => {
                if (cmd.name && cmd.name.length > 32)
                    validationErrors.push(`Command ${cmd.name} has name longer than 32 chars`);
                if (cmd.description && cmd.description.length > 110)
                    validationErrors.push(`Command ${cmd.name} has description longer than 110 chars`);
                
                if (cmd.options) {
                    cmd.options.forEach((option) => {
                        if (option.name && option.name.length > 32)
                            validationErrors.push(`Command ${cmd.name} option ${option.name} has name longer than 32 chars`);
                        if (option.description && option.description.length > 110)
                            validationErrors.push(`Command ${cmd.name} option ${option.name} has description longer than 110 chars`);
                        
                        if (option.choices) {
                            option.choices.forEach((choice) => {
                                if (choice.name && choice.name.length > 110)
                                    validationErrors.push(`Choice ${choice.name} has name longer than 110 chars`);
                                if (choice.value && choice.value.length > 100)
                                    validationErrors.push(`Choice ${choice.name} has value longer than 100 chars`);
                            });
                        }
                        
                        if (option.options) {
                            option.options.forEach((subOption) => {
                                if (subOption.name && subOption.name.length > 32)
                                    validationErrors.push(`Subcommand option ${subOption.name} has name longer than 32 chars`);
                                if (subOption.description && subOption.description.length > 110)
                                    validationErrors.push(`Subcommand option ${subOption.name} has description longer than 110 chars`);
                            });
                        }
                    });
                }
            });
            
            if (validationErrors.length > 0) {
                logger.error('Command validation failed. Errors:');
                validationErrors.forEach(error => logger.error(`  - ${error}`));
                throw new Error(`Command validation failed with ${validationErrors.length} errors`);
            }
            
            logger.info('Command validation passed');
            
            const guild = await client.guilds.fetch(guildId);
            const existingCommands = await guild.commands.fetch();
            logger.info(`Found ${existingCommands.size} existing guild commands`);
            
            const MAX_COMMANDS = 100;
            let commandsToRegister = commands;
            
            if (commands.length > MAX_COMMANDS) {
                logger.warn(`Command count (${commands.length}) exceeds Discord limit (${MAX_COMMANDS}), truncating...`);
                commandsToRegister = commands.slice(0, MAX_COMMANDS);
            }
            
            try {
                logger.info(`Registering ${commandsToRegister.length} new commands...`);
                await guild.commands.set(commandsToRegister);
                logger.info(`Successfully registered ${commandsToRegister.length} guild commands`);
                
                const registeredCommands = await guild.commands.fetch();
                if (registeredCommands.size !== commandsToRegister.length) {
                    logger.warn(`Warning: Expected ${commandsToRegister.length} commands, Discord reports ${registeredCommands.size}`);
                } else {
                    logger.info(`Verification passed: ${registeredCommands.size} commands successfully registered`);
                }
                
            } catch (error) {
                logger.error('Failed to register commands:', error);
                
                if (existingCommands.size > 0) {
                    logger.info('Attempting to restore previous commands...');
                    try {
                        await guild.commands.set(existingCommands.map(cmd => cmd));
                        logger.info('Successfully restored previous commands');
                    } catch (restoreError) {
                        logger.error('Failed to restore previous commands:', restoreError);
                    }
                }
                
                throw error;
            }

        } else {
            // ✅ Sin GUILD_ID → registrar globalmente en todos los servidores
            // ⚠️ Los comandos globales tardan hasta 1 hora en propagarse en Discord
            // Discord rechaza > 100 comandos (DiscordAPIError 30032). Truncar
            // defensivamente para que nunca tumbe el arranque.
            let globalCommands = commands;
            if (globalCommands.length > 100) {
                logger.warn(`Global command count (${globalCommands.length}) exceeds Discord limit (100), truncating to 100`);
                globalCommands = globalCommands.slice(0, 100);
            }
            logger.info(`Registering ${globalCommands.length} commands GLOBALLY (all servers)...`);
            await client.application.commands.set(globalCommands);
            logger.info(`✅ Successfully registered ${globalCommands.length} global commands`);
            logger.info('⏳ Note: Global commands can take up to 1 hour to appear in all servers');
        }

    } catch (error) {
        logger.error('Error registering commands:', error);
        throw error;
    }
}

export async function reloadCommand(client, commandName) {
    const command = client.commands.get(commandName);
    
    if (!command) {
        return { success: false, message: `Command "${commandName}" not found` };
    }
    
    try {
        const commandPath = path.resolve(command.filePath);
        const moduleUrl = pathToFileURL(commandPath);
        moduleUrl.searchParams.set('t', Date.now().toString());

        const newCommand = (await import(moduleUrl.href)).default;
        
        client.commands.set(commandName, newCommand);
        
        logger.info(`Reloaded command: ${commandName}`);
        return { success: true, message: `Successfully reloaded command "${commandName}"` };
    } catch (error) {
        logger.error(`Error reloading command "${commandName}":`, error);
        return { success: false, message: `Error reloading command: ${error.message}` };
    }
}