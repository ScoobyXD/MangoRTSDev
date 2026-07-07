import json
from collections import Counter
from pathlib import Path


DEV = Path("tmp/schema-audit-dev.json")
PROD = Path("tmp/schema-audit-prod.json")
OUT = Path("tmp/schema-audit-dev-vs-prod-classified.txt")


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def filtered(rows):
    return [
        row
        for row in rows
        if row["object_kind"] != "grant"
        and "schema_migrations" not in row["object_identity"]
    ]


def key(row):
    return (row["object_kind"], row["object_identity"])


def norm_value(value):
    if isinstance(value, str):
        return value.replace("\r\n", "\n").replace("\r", "\n")
    if isinstance(value, list):
        return [norm_value(item) for item in value]
    if isinstance(value, dict):
        return {name: norm_value(item) for name, item in value.items()}
    return value


def compact(definition):
    return json.dumps(norm_value(definition), sort_keys=True, separators=(",", ":"))


def without_ordinal(definition):
    copy = dict(definition)
    copy.pop("ordinal_position", None)
    return copy


def changed_fields(expected, actual):
    fields = sorted(set(expected) | set(actual))
    return [
        f"{field}: {expected.get(field)!r} -> {actual.get(field)!r}"
        for field in fields
        if norm_value(expected.get(field)) != norm_value(actual.get(field))
    ]


def main():
    dev = {key(row): row for row in filtered(load(DEV))}
    prod = {key(row): row for row in filtered(load(PROD))}

    missing_keys = sorted(set(dev) - set(prod))
    extra_keys = sorted(set(prod) - set(dev))
    different_keys = sorted(
        k for k in set(dev) & set(prod)
        if compact(dev[k]["definition"]) != compact(prod[k]["definition"])
    )

    ordinal_only = []
    real_different = []
    for k in different_keys:
        expected = dev[k]["definition"]
        actual = prod[k]["definition"]
        if k[0] == "column" and compact(without_ordinal(expected)) == compact(without_ordinal(actual)):
            ordinal_only.append(k)
        else:
            real_different.append(k)

    missing_by_kind = Counter(kind for kind, _ in missing_keys)
    extra_by_kind = Counter(kind for kind, _ in extra_keys)
    different_by_kind = Counter(kind for kind, _ in different_keys)
    real_different_by_kind = Counter(kind for kind, _ in real_different)

    lines = []
    lines.append("Dev vs prod schema diff classification")
    lines.append("")
    lines.append(f"Compared objects: dev={len(dev)} prod={len(prod)}")
    lines.append(f"Missing in prod: {len(missing_keys)} {dict(missing_by_kind)}")
    lines.append(f"Extra in prod: {len(extra_keys)} {dict(extra_by_kind)}")
    lines.append(f"Different definitions: {len(different_keys)} {dict(different_by_kind)}")
    lines.append(f"Column-order-only diffs: {len(ordinal_only)}")
    lines.append(f"Real definition diffs after ignoring column order and line endings: {len(real_different)} {dict(real_different_by_kind)}")
    lines.append("")

    lines.append("Missing in prod")
    for k in missing_keys:
        item = dev[k]
        lines.append(f"- {k[0]} {k[1]}")
        lines.append(f"  {json.dumps(norm_value(item['definition']), sort_keys=True)}")
    lines.append("")

    lines.append("Extra in prod")
    for k in extra_keys:
        item = prod[k]
        lines.append(f"- {k[0]} {k[1]}")
        lines.append(f"  {json.dumps(norm_value(item['definition']), sort_keys=True)}")
    lines.append("")

    lines.append("Real definition diffs")
    for k in real_different:
        expected = dev[k]["definition"]
        actual = prod[k]["definition"]
        lines.append(f"- {k[0]} {k[1]}")
        if isinstance(expected, dict) and isinstance(actual, dict):
            for field in changed_fields(expected, actual):
                lines.append(f"  {field}")
        else:
            lines.append(f"  expected={json.dumps(norm_value(expected), sort_keys=True)}")
            lines.append(f"  actual={json.dumps(norm_value(actual), sort_keys=True)}")
    lines.append("")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:12]))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
