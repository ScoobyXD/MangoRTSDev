export type FieldConfigOption = { key: string; label: string; color?: string };
export type FieldConfig = { default?: string | null; options?: FieldConfigOption[] };

type SelectedChoice = { key: string; label: string };

const REQUIRED_STATUS_KEYS = ["in_progress", "pending", "done"] as const;

export function buildChoiceFieldConfig(
  current: FieldConfig,
  selectedChoices: readonly SelectedChoice[],
  additionLabels: readonly string[],
  systemKey = "",
): FieldConfig {
  const existingKeys = new Set((current.options ?? []).map((option) => option.key));
  const selectedKeys = new Set<string>();
  const options: FieldConfigOption[] = [];

  for (const choice of selectedChoices) {
    const key = choice.key.trim();
    if (!existingKeys.has(key) || selectedKeys.has(key)) continue;
    const label = choice.label.trim();
    if (!label) throw new Error("Every selected choice needs a label.");
    selectedKeys.add(key);
    options.push({ key, label });
  }

  const reservedKeys = new Set(existingKeys);
  for (const rawLabel of additionLabels) {
    const label = rawLabel.trim();
    if (!label) continue;
    const slug = slugOptionKey(label);
    const base = /^[a-z]/.test(slug) ? slug : `option_${slug || options.length + 1}`;
    let key = base;
    for (let suffix = 2; reservedKeys.has(key); suffix += 1) key = `${base}_${suffix}`;
    reservedKeys.add(key);
    options.push({ key, label });
  }

  if (options.length === 0) throw new Error("Enter at least one choice.");
  if (systemKey === "status") {
    const optionKeys = new Set(options.map((option) => option.key));
    if (options.length !== REQUIRED_STATUS_KEYS.length || REQUIRED_STATUS_KEYS.some((key) => !optionKeys.has(key))) {
      throw new Error("Action Item Status must keep its three required choices.");
    }
  }

  const defaultKey = typeof current.default === "string" && options.some((option) => option.key === current.default) ? current.default : null;
  return { default: defaultKey, options };
}

function slugOptionKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}
