#!/usr/bin/env python3
"""Extract alternate Open Food Facts names for already imported catalogue foods.

The output is a tabular staging file for catalog_food_aliases. It contains no
food rows or nutrients. Product IDs use the same stable UUID rule as the OFF
catalogue importer.
"""
import argparse
import csv
import gzip
import json
import re
import sys
import uuid


FIELD = re.compile(r"^(product_name|generic_name)(?:_([a-z]{2,3}))?$")


def clean(value):
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()


def alias_locale(language, food_locale):
    if not language:
        return food_locale or "und"
    if food_locale and food_locale.lower().startswith(language + "-"):
        return food_locale
    return language


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--products", required=True, help="Open Food Facts JSONL gzip archive")
    parser.add_argument("--imported-codes", required=True, help="One imported OFF product code per line")
    parser.add_argument("--output", required=True, help="CSV staging output path")
    args = parser.parse_args()

    with open(args.imported_codes, encoding="utf-8") as file:
        imported = {line.strip() for line in file if line.strip()}

    seen = set()
    written = 0
    scanned = 0
    with gzip.open(args.products, "rt", encoding="utf-8") as products, open(args.output, "w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter="\t", lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
        writer.writerow(("food_id", "alias", "locale", "origin", "source_field"))
        for line in products:
            scanned += 1
            if scanned % 100000 == 0:
                print(f"Scanned {scanned:,}; wrote {written:,} aliases", file=sys.stderr, flush=True)
            try:
                product = json.loads(line)
            except json.JSONDecodeError:
                continue
            code = str(product.get("code") or product.get("_id") or "").strip()
            if not code or code not in imported:
                continue
            food_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "off:" + code))
            canonical = clean(product.get("product_name_en") or product.get("product_name") or
                              product.get("generic_name_en") or product.get("generic_name"))
            food_locale = "en-GB" if any(
                tag in {"en:united-kingdom", "en:uk", "en:great-britain"}
                for tag in product.get("countries_tags", [])
            ) else "en"
            for field, raw_alias in product.items():
                match = FIELD.fullmatch(field)
                if not match:
                    continue
                alias = clean(raw_alias)
                if len(alias) < 2 or len(alias) > 240 or alias.casefold() == canonical.casefold():
                    continue
                locale = alias_locale(match.group(2), food_locale)
                key = (food_id, alias.casefold(), locale)
                if key in seen:
                    continue
                seen.add(key)
                writer.writerow((food_id, alias, locale, "source", field))
                written += 1
    print(f"Complete: scanned {scanned:,}; wrote {written:,} aliases", file=sys.stderr)


if __name__ == "__main__":
    main()
