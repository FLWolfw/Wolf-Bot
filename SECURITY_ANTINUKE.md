# Wolf Security / Anti-Nuke v1

## What this adds

- Persistent security logs in PostgreSQL, independent of Discord log channels.
- Anti-Nuke monitoring for channel create/delete, role create/delete and bans.
- Audit Log correlation to identify the executor.
- Critical incidents with a unique incident ID.
- Automatic quarantine when the threshold is exceeded and the bot can manage the member.
- Dashboard page: `/server/:id/security`.

## Default thresholds

- Channel delete: 3 actions / 10 seconds
- Channel create: 5 actions / 10 seconds
- Role create: 3 actions / 10 seconds
- Role delete: 3 actions / 10 seconds
- Ban: 3 actions / 10 seconds

These can be overridden in Railway with `ANTI_NUKE_*` variables. The bot also creates the security tables automatically when PostgreSQL is available.

## Required Discord permissions

Give Wolf at least:

- View Audit Log
- Manage Roles
- Moderate Members
- Manage Channels

Keep Wolf's highest role above the roles it needs to remove/manage.

## Important

Test this on a disposable Discord server first. The external PostgreSQL logs are designed to survive deletion of the Discord log channel, but they cannot record events that occur after the bot has been removed or disconnected.
