import { normGroup } from "#8xmnu037caa7";
import { toTrimmedString as toString } from "@trebired/utils";

function normalizeGroupPrefix(input: false | string | undefined): false | string {
  if (input === false) return false;
  const rawPrefix = toString(input);
  if (!rawPrefix) return false;
  return normGroup(rawPrefix).key || false;
}

function applyGroupPrefix(group: string, prefix: false | string): string {
  if (!prefix) return group;
  if (group === prefix || group.startsWith(`${prefix}.`)) return group;
  return `${prefix}.${group}`;
}

function packageGroupPrefixFromSource(input: unknown): false | string {
  const source = toString(input);
  const scoped = new RegExp("^@([^/]+)/(.+)$", "u").exec(source);
  if (!scoped) return false;
  const name = (scoped[2] as string).replace(new RegExp("[/@]+", "g"), ".");
  return normGroup(`${scoped[1]}.${name}`).key || false;
}

export { applyGroupPrefix, normalizeGroupPrefix, packageGroupPrefixFromSource };
