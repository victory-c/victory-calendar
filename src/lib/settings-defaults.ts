// Runtime settings rows (guide: settings table). Second-level kill switches live here,
// not in env vars. SHOW_ATTENDANCE env only forces attendance off at deploy time.
export const SETTINGS_DEFAULTS = {
  show_attendance: { on: true },
  cover_policy_default: { policy: 'official' } as { policy: 'official' | 'template' },
  going_visibility_default: { v: 'public' } as { v: 'public' | 'after_event' | 'hidden' },
  official_covers_to_template: { on: false },
} as const;

export type SettingKey = keyof typeof SETTINGS_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS_DEFAULTS)[K];
