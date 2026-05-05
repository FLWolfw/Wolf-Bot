const deleteTracker = new Map();

const LIMIT = 3; // canales
const TIME = 10000; // 10 segundos

export async function handleChannelDelete(channel, executor) {
  if (!executor || executor.bot) return;

  const key = executor.id;
  const now = Date.now();

  if (!deleteTracker.has(key)) {
    deleteTracker.set(key, []);
  }

  const actions = deleteTracker.get(key).filter(t => now - t < TIME);
  actions.push(now);
  deleteTracker.set(key, actions);

  if (actions.length >= LIMIT) {
    // 🚨 CASTIGO
    try {
      const member = await channel.guild.members.fetch(executor.id);

      // quitar roles (opcional)
      await member.roles.set([]);

      // o ban directo:
      // await member.ban({ reason: 'Anti-nuke: deleting channels' });

      return true;
    } catch (err) {
      console.error('Anti-nuke error:', err);
    }
  }

  return false;
}