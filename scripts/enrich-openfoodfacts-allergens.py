#!/usr/bin/env python3
"""Prepare a local SQL refresh of allergen fields for imported OFF products.

Streams the OFF JSONL archive without extracting it. The source-record IDs are
provided from the local catalogue so unrelated archive products are skipped.
The generated SQL is temporary enrichment input and must not be committed.
"""
import argparse
import csv
import gzip
import json
import re
from pathlib import Path


SOURCE_CODE = re.compile(rb'"(?:code|_id)"\s*:\s*"([^"]+)"')
EVIDENCE_FIELDS = (
    "allergens_from_ingredients",
    "allergens_from_user",
    "traces_from_ingredients",
    "traces_from_user",
)


def tags(value):
    if not isinstance(value, list):
        return None
    clean = [item.strip() for item in value if isinstance(item, str) and item.strip()]
    return ",".join(clean)[:2000] or None


def allergen_evidence(product):
    evidence = {}
    for key in EVIDENCE_FIELDS:
        value = product.get(key)
        if not isinstance(value, str):
            continue
        content = re.sub(r"^\([a-z]{2,3}\)\s*", "", value.strip(), flags=re.IGNORECASE).strip()
        if content:
            evidence[key] = value
    gs1 = (product.get("sources_fields") or {}).get("org-gs1") or {}
    indicator = gs1.get("isAllergenRelevantDataProvided")
    if isinstance(indicator, str) and indicator.strip():
        evidence["gs1_is_allergen_relevant_data_provided"] = indicator
    return evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--catalogue-ids", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    source_ids = {line.strip() for line in args.catalogue_ids.open() if line.strip()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    matched = 0
    scanned = 0
    with args.archive.open("rb") as compressed, gzip.GzipFile(fileobj=compressed) as source, args.output.open("w", newline="") as output:
        output.write("BEGIN;\n")
        output.write("CREATE TEMP TABLE off_allergen_stage(source_record_id text, source_position bigint, allergens text, allergen_traces text, evidence jsonb NOT NULL);\n")
        output.write("COPY off_allergen_stage(source_record_id,source_position,allergens,allergen_traces,evidence) FROM STDIN WITH (FORMAT csv, NULL '');\n")
        writer = csv.writer(output, lineterminator="\n")
        for scanned, raw_line in enumerate(source, start=1):
            match = SOURCE_CODE.search(raw_line)
            if not match:
                continue
            source_record_id = match.group(1).decode("utf-8", errors="replace").strip()
            if source_record_id not in source_ids:
                continue
            try:
                product = json.loads(raw_line)
            except json.JSONDecodeError:
                continue
            source_record_id = str(product.get("code") or product.get("_id") or "").strip()
            if source_record_id not in source_ids:
                continue
            writer.writerow((
                source_record_id,
                scanned,
                tags(product.get("allergens_tags")),
                tags(product.get("traces_tags")),
                json.dumps(allergen_evidence(product), ensure_ascii=False, separators=(",", ":")),
            ))
            matched += 1
            if scanned % 500000 == 0:
                print(f"Scanned {scanned:,} source rows; matched {matched:,} catalogue products", flush=True)
        output.write("\\.\n")
        output.write("UPDATE public.catalog_foods AS food SET allergens = stage.allergens, allergen_traces = stage.allergen_traces, source_metadata = CASE WHEN stage.evidence = '{}'::jsonb THEN food.source_metadata ELSE food.source_metadata || jsonb_build_object('allergen_evidence', stage.evidence) END FROM (SELECT DISTINCT ON (source_record_id) source_record_id, allergens, allergen_traces, evidence FROM off_allergen_stage ORDER BY source_record_id, source_position DESC) AS stage WHERE food.source_id = 'openfoodfacts' AND food.source_record_id = stage.source_record_id;\n")
        output.write("SELECT (SELECT count(DISTINCT source_record_id) FROM off_allergen_stage) AS staged_products, (SELECT count(*) FROM public.catalog_foods WHERE source_id='openfoodfacts' AND allergen_traces IS NOT NULL) AS products_with_trace_tags, (SELECT count(*) FROM public.catalog_foods WHERE source_id='openfoodfacts' AND source_metadata ? 'allergen_evidence') AS products_with_source_evidence;\nCOMMIT;\n")
    print(f"Prepared {matched:,} matching product rows from {scanned:,} source rows into {args.output}")


if __name__ == "__main__":
    main()
