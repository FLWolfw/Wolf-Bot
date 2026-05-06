import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async function loadEvents(client) {

  const eventsPath = join(__dirname, '../events');

  async function load(dir) {

    const files = await readdir(dir);

    for (const file of files) {

      const filePath = join(dir, file);
      const fileStat = await stat(filePath);

      if (fileStat.isDirectory()) {

        // 🔥 entra en /logs
        await load(filePath);

      } else if (file.endsWith('.js')) {

        try {

          const { default: event } =
            await import(`file://${filePath}`);

          if (!event?.name || typeof event.execute !== 'function') {
            logger.warn(`Event ${file} inválido`);
            continue;
          }

          const safeExecute = async (...args) => {
            try {
              await event.execute(...args);
            } catch (error) {
              logger.error(`Error en ${event.name}:`, error);
            }
          };

          if (event.once) {
            client.once(event.name, safeExecute);
          } else {
            client.on(event.name, safeExecute);
          }

          console.log(`✅ Loaded event: ${event.name}`);

        } catch (err) {
          logger.error(`Error cargando ${file}:`, err);
        }

      }

    }

  }

  await load(eventsPath);

}