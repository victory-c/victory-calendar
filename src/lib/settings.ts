import 'server-only';
import { eq } from 'drizzle-orm';
import { db, hasDatabase } from './db';
import { settings } from './db/schema';
import { SETTINGS_DEFAULTS, type SettingKey, type SettingValue } from './settings-defaults';

export async function readSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  if (!hasDatabase()) return SETTINGS_DEFAULTS[key];
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as SettingValue<K>) ?? SETTINGS_DEFAULTS[key];
}

/** Master attendance switch: SHOW_ATTENDANCE=false forces it off at deploy time. */
export async function showAttendance() {
  if (process.env.SHOW_ATTENDANCE === 'false') return false;
  return (await readSetting('show_attendance')).on;
}

export async function writeSetting<K extends SettingKey>(key: K, value: SettingValue<K> | Record<string, unknown>) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
