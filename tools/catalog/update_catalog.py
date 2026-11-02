#!/usr/bin/env python3
"""Refresh beer-save/beer-catalog.js from manufacturers' official pages.

Usage (from the repository root):
    python3 tools/catalog/update_catalog.py              # all sources, write the file
    python3 tools/catalog/update_catalog.py --dry-run    # report only
    python3 tools/catalog/update_catalog.py --only asahi,kirin

Merge rules (the app compares saved products with catalog entries field by
field, including `revision`, so unchanged entries must stay byte-identical):
- An existing JAN with the same volume / alcohol / calories is left as is
  (a value that was blank stays blank; the run only counts those).
- An existing JAN whose facts changed is updated and gets a new revision.
- A new JAN is appended.
- Entries that were not found this time are kept (discontinued cans still
  get scanned), and sources that could not be read keep their old entries.
"""
import argparse
import datetime
import hashlib
import importlib
import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import Blocked, Fetcher, tidy_number  # noqa: E402

REPO = HERE.parent.parent
CATALOG = REPO / "beer-save" / "beer-catalog.js"
HEADER = "/* Public product facts; automatic collection never writes user records. */\n"
WRAP_START = ("(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();"
              "else root.BeerCatalog=factory();})(typeof window!=='undefined'?window:this,function(){return Object.freeze(")
WRAP_END = ");});\n"
SOURCES = ["asahi", "kirin", "takara"]
# Runs only with --only: it checks official facts but can add nothing, as the site has no JANs.
OPTIONAL = ["sapporo"]
# Sources whose data cannot be collected automatically; their entries are kept as they are.
MANUAL = {
    "sapporo": {"manufacturer": "サッポロビール", "status": "manual",
                "reason": "Official site does not publish JAN codes"},
    "suntory": {"manufacturer": "サントリー", "status": "manual",
                "reason": "Official product pages refuse automated access (HTTP 403)"},
    "sangaria": {"manufacturer": "サンガリア", "status": "manual",
                 "reason": "JAN is in image-based PDF; automatic addition disabled"},
}
FACTS = ("volumeMl", "alcoholPercent", "caloriesKcal")


def load_catalog(path=CATALOG):
    text = path.read_text(encoding="utf-8")
    start = text.index("Object.freeze(") + len("Object.freeze(")
    end = text.rindex(WRAP_END.strip())
    return json.loads(text[start:end])


def write_catalog(catalog, path=CATALOG):
    # "<" is escaped so the data can never close a <script> element.
    body = json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    path.write_text(HEADER + WRAP_START + body + WRAP_END, encoding="utf-8")


def run_sources(names, fetcher):
    results = {}
    for name in names:
        module = importlib.import_module(f"sources.{name}")
        started = time.monotonic()
        print(f"[{name}] collecting...", flush=True)
        try:
            out = module.collect(fetcher, log=lambda msg: print(msg, flush=True))
            records = [r for r in out["records"] if r.get("janCode")]
            status = "partial" if out.get("pageErrors") else "ok"
            if not records:
                status = "unavailable" if out.get("pageErrors") else "empty"
            results[name] = {"manufacturer": module.MANUFACTURER, "status": status, "records": records,
                             "pageErrors": out.get("pageErrors", []), "note": out.get("note", "")}
        except Blocked as e:
            results[name] = {"manufacturer": module.MANUFACTURER, "status": "unavailable", "records": [],
                             "pageErrors": [], "error": str(e)}
        except Exception as e:  # a broken parser must not stop the other sources
            results[name] = {"manufacturer": module.MANUFACTURER, "status": "failed", "records": [],
                             "pageErrors": [], "error": f"{type(e).__name__}: {e}"}
        r = results[name]
        print(f"[{name}] {r['status']}: {len(r['records'])} records, {len(r['pageErrors'])} page errors, "
              f"{time.monotonic() - started:.0f}s", flush=True)
    return results


def merge(catalog, results, today):
    products = catalog["products"]
    by_jan = {p["janCode"]: p for p in products}
    revision = f"公式情報確認 {today}"
    report = {"added": [], "changed": [], "unchanged": 0, "fillable": 0, "notFound": []}
    for name, result in results.items():
        seen = set()
        for rec in result["records"]:
            jan = rec["janCode"]
            if jan in seen:
                continue
            seen.add(jan)
            old = by_jan.get(jan)
            if old is None:
                entry = new_entry(rec, revision)
                products.append(entry)
                by_jan[jan] = entry
                report["added"].append(entry)
                continue
            if old["manufacturer"] != rec["manufacturer"]:
                continue
            # A value missing from the old entry is not filled in: any field change makes
            # users' saved copies count as a different product, which a backfill isn't worth.
            if any(old.get(k) is None and rec.get(k) is not None for k in FACTS):
                report["fillable"] += 1
            diffs = {k: (old.get(k), rec.get(k)) for k in FACTS
                     if old.get(k) is not None and not same(old.get(k), rec.get(k))}
            if not diffs:
                report["unchanged"] += 1
                continue
            for key, (_, value) in diffs.items():
                old[key] = value
            old["revision"] = revision + ("・製造終了掲載" if rec.get("discontinued") else "")
            old["source"] = rec["source"]
            report["changed"].append({"janCode": jan, "productName": old["productName"], "diffs": diffs})
        if result["status"] in ("ok", "partial") and not result["pageErrors"]:
            report["notFound"] += [p for p in products if p["manufacturer"] == result["manufacturer"]
                                   and p["janCode"] not in seen]
    return report


def same(a, b):
    if b is None:  # the page did not state it; keep what we had
        return True
    if a is None:
        return False
    return abs(float(a) - float(b)) < 0.05


def new_entry(rec, revision):
    name = rec["productName"]
    # Photo recognition matches any alias found in the label text, so a bare series name
    # ("贅沢搾り") would match every flavor. Like the hand-made entries, the only extra
    # alias is the name without the maker prefix.
    aliases = [name]
    short = re.sub(r"^(アサヒ|キリン|タカラ|サッポロ)\s*", "", name)
    if short != name and len(short) >= 2:
        aliases.append(short)
    brand = rec.get("brand") or ""
    return {
        "id": f"catalog-{rec['janCode']}", "manufacturer": rec["manufacturer"], "brand": brand,
        "productName": name, "flavor": rec.get("flavor") or "", "category": rec["category"],
        "containerType": "can", "volumeMl": int(rec["volumeMl"]),
        "alcoholPercent": tidy_number(rec["alcoholPercent"]), "caloriesKcal": tidy_number(rec.get("caloriesKcal")),
        "sugarGrams": tidy_number(rec.get("sugarGrams")), "janCode": rec["janCode"],
        "revision": revision + ("・製造終了掲載" if rec.get("discontinued") else ""),
        "source": rec["source"], "aliases": aliases, "excludeTokens": [], "catalog": True,
    }


def auto_update(previous, results, today):
    sources = dict((previous or {}).get("sources", {}))
    for name, r in results.items():
        info = {"manufacturer": r["manufacturer"], "status": r["status"], "verifiedRecords": len(r["records"]),
                "pageErrors": r["pageErrors"][:10]}
        if r.get("error"):
            info["error"] = r["error"]
        if r.get("note"):
            info["note"] = r["note"]
        sources[name] = info
    for name, info in MANUAL.items():
        if name not in results:
            sources[name] = dict(info)
    partial = any(s.get("status") != "ok" for s in sources.values())
    return {"checkedOn": today, "frequency": "manual", "partial": partial, "sources": sources}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated sources: " + ",".join(SOURCES + OPTIONAL))
    parser.add_argument("--dry-run", action="store_true", help="report changes without writing the catalog")
    parser.add_argument("--cache", help="directory for cached pages (re-runs without hitting the sites)")
    parser.add_argument("--report", help="write a JSON report of the run to this path")
    args = parser.parse_args()
    names = args.only.split(",") if args.only else SOURCES
    unknown = [n for n in names if n not in SOURCES + OPTIONAL]
    if unknown:
        parser.error("unknown source: " + ", ".join(unknown))

    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
    catalog = load_catalog()
    before = len(catalog["products"])
    results = run_sources(names, Fetcher(cache_dir=args.cache))
    report = merge(catalog, results, today)

    catalog["autoUpdate"] = auto_update(catalog.get("autoUpdate"), results, today)
    if report["added"] or report["changed"]:
        catalog["verifiedOn"] = today
    digest = hashlib.sha256(json.dumps(catalog["products"], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    catalog["version"] = f"catalog-auto-{catalog['verifiedOn'].replace('-', '')}-{digest[:12]}"

    print()
    print(f"products: {before} -> {len(catalog['products'])}")
    print(f"added: {len(report['added'])}, changed: {len(report['changed'])}, unchanged: {report['unchanged']}, "
          f"kept but not found this run: {len(report['notFound'])}, "
          f"left blank although the site now lists a value: {report['fillable']}")
    for e in report["added"]:
        print(f"  + {e['janCode']} {e['manufacturer']} {e['productName']} {e['volumeMl']}ml {e['alcoholPercent']}% "
              f"{e['caloriesKcal']}kcal [{e['category']}]")
    for c in report["changed"]:
        print(f"  ~ {c['janCode']} {c['productName']} " + ", ".join(f"{k}: {a} -> {b}" for k, (a, b) in c["diffs"].items()))
    if args.report:
        Path(args.report).write_text(json.dumps({
            "date": today, "sources": catalog["autoUpdate"]["sources"],
            "added": report["added"], "changed": report["changed"],
            "notFound": [{"janCode": p["janCode"], "productName": p["productName"]} for p in report["notFound"]],
        }, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.dry_run:
        print("dry run: catalog not written")
        return
    write_catalog(catalog)
    print(f"wrote {CATALOG.relative_to(REPO)} ({catalog['version']})")


if __name__ == "__main__":
    main()
