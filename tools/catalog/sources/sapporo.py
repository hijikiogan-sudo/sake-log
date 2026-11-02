"""Sapporo Beer (サッポロビール) canned products from www.sapporobeer.jp.

The official product pages (/product/<category>/<slug>/) list the lineup
(e.g. "350ml缶"), alcohol %, and nutrition per 100ml, and the discontinued
list (/product/close/) keeps pages for ended products. As of 2026-11 the
official site does NOT publish JAN codes on product pages, the nutrition list,
or press releases, so a record is emitted only when a JAN actually appears on
the official page. JANs are never taken from retailer sites.
"""
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from common import Blocked, Fetcher, links, number, page_text, tidy_number, valid_jan, guess_category  # noqa: E402

MANUFACTURER = "サッポロビール"
BASE = "https://www.sapporobeer.jp"
LINEUPS = ["beer", "sour", "shochu", "japanese_liquor", "overseas_liquor", "wine"]
CLOSE = BASE + "/product/close/"
NUTRITION = BASE + "/product/nutrition/"
DETAIL = r"^https://www\.sapporobeer\.jp/product/(beer|sour|shochu|japanese_liquor|overseas_liquor|wine|spirits|umeshu|liquor)/[a-z0-9_]+/$"

NUTRITION_SECTIONS = {
    "ビール": "beer",
    "発泡酒": "happoshu",
    "新ジャンル": "happoshu",
    "微アルコールビールテイスト飲料": "beer",
    "ノンアルコールビールテイスト飲料": None,  # non-alcoholic: skipped
}
PREFIXES = ["サッポロ生ビール", "サッポロサワー", "サッポロ", "ヱビス"]


def norm(text):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text or "")).strip()


def nutrition_sections(fetcher):
    """Map detail URL -> category from the official nutrition list (ビール/発泡酒/...)."""
    markup = fetcher.get_text(NUTRITION)
    found = {}
    parts = re.split(r"<h2[^>]*>(.*?)</h2>", markup, flags=re.S)
    for i in range(1, len(parts) - 1, 2):
        heading = norm(re.sub(r"<[^>]+>", "", parts[i]))
        if heading not in NUTRITION_SECTIONS:
            continue
        for url in links(parts[i + 1], NUTRITION, DETAIL):
            found.setdefault(url, NUTRITION_SECTIONS[heading])
    return found


def first(pattern, text, flags=re.S):
    m = re.search(pattern, text, flags)
    return m.group(1) if m else None


def brand_of(name):
    for p in PREFIXES:
        if name.startswith(p) and len(name) > len(p):
            rest = name[len(p):].strip()
            return "ヱビス" if p == "ヱビス" else rest
    return name


def find_jans(text):
    """JAN codes that the page itself labels as JAN (13 or 8 digits, check digit valid)."""
    out = []
    for m in re.finditer(r"JAN(?:コード)?[^0-9]{0,20}(\d[\d\- ]{6,16}\d)", text, re.I):
        code = valid_jan(m.group(1))
        if code and code not in [c for _, c in out]:
            out.append((m.start(), code))
    return out


def parse_detail(url, markup, sections, discontinued):
    text = norm(page_text(markup))
    name = norm(re.sub(r"<[^>]+>", "", first(r'class="m-sb-product-detail_data".*?<h1[^>]*>(.*?)</h1>', markup) or ""))
    if not name:
        return [], "no product name"
    kind = norm(re.sub(r"<[^>]+>", "", first(r'class="m-sb-product-detail_kind"[^>]*>(.*?)</p>', markup) or ""))
    if "ノンアルコール" in name or "アルコールフリー" in name:
        return [], None
    alcohol = first(r"アルコール分\|\s*([0-9.]+)\s*[%％]", text)
    alcohol = tidy_number(number(alcohol)) if alcohol else None
    if alcohol is not None and alcohol <= 0:
        return [], None
    kcal100 = first(r"エネルギー\|\s*([0-9.]+)\s*kcal", text, re.S | re.I)
    kcal100 = number(kcal100) if kcal100 else None

    if url in sections:
        category = sections[url]
        if category is None:
            return [], None
    elif "ワイン" in kind:
        category = "wine"
    elif "焼酎" in kind:
        category = "shochu"
    elif "ビールテイスト" in kind:
        category = guess_category(name, "ビール")
    else:
        category = guess_category(name)

    lineup = markup.split("ラインアップ", 1)[1] if "ラインアップ" in markup else ""
    lineup = lineup.split("成分表", 1)[0]
    captions = [norm(re.sub(r"<[^>]+>", "", c)) for c in re.findall(r"<figcaption>(.*?)</figcaption>", lineup, re.S)]
    cans = []
    for cap in captions:
        m = re.search(r"(\d+)\s*ml\s*缶", cap, re.I)
        if m:
            flavor = norm(cap[:m.start()] + cap[m.end():]).strip("・/ ")
            cans.append((int(m.group(1)), flavor))
    if not cans:
        return [], None  # bottles/kegs only

    jans = find_jans(text)
    records = []
    for volume, flavor in cans:
        jan = None
        if len(jans) == 1 and len(cans) == 1:
            jan = jans[0][1]
        elif jans:
            # Pair a JAN with the nearest preceding mention of this can size.
            for pos, code in jans:
                window = text[max(0, pos - 120):pos]
                if re.search(rf"{volume}\s*ml\s*缶", window):
                    jan = code
        records.append({
            "manufacturer": MANUFACTURER,
            "brand": brand_of(name),
            "productName": name,
            "flavor": flavor,
            "category": category,
            "volumeMl": volume,
            "alcoholPercent": alcohol,
            "caloriesKcal": tidy_number(kcal100 * volume / 100) if kcal100 is not None else None,
            "sugarGrams": None,
            "janCode": jan,
            "source": url,
            "discontinued": discontinued,
        })
    return records, None


def collect(fetcher, log=print, include_discontinued=True):
    """Return {"records": [...], "pageErrors": [{"url":..., "error":...}], "note": "optional short text"}"""
    page_errors = []
    try:
        sections = nutrition_sections(fetcher)
    except Blocked:
        raise
    except Exception as e:
        page_errors.append({"url": NUTRITION, "error": str(e)})
        sections = {}

    current, ended = [], []
    for name in LINEUPS:
        url = f"{BASE}/product/lineup/{name}/"
        try:
            for u in links(fetcher.get_text(url), url, DETAIL):
                if u not in current:
                    current.append(u)
        except Blocked:
            raise
        except Exception as e:
            page_errors.append({"url": url, "error": str(e)})
    if include_discontinued:
        try:
            ended = [u for u in links(fetcher.get_text(CLOSE), CLOSE, DETAIL) if u not in current]
        except Blocked:
            raise
        except Exception as e:
            page_errors.append({"url": CLOSE, "error": str(e)})
    log(f"  sapporo: {len(current)} current + {len(ended)} discontinued product pages")

    candidates = []
    for i, url in enumerate(current + ended, 1):
        try:
            recs, err = parse_detail(url, fetcher.get_text(url), sections, url in ended)
            if err:
                page_errors.append({"url": url, "error": err})
            candidates.extend(recs)
        except Blocked:
            raise
        except Exception as e:
            page_errors.append({"url": url, "error": str(e)})
        if i % 25 == 0:
            log(f"  sapporo: {i}/{len(current) + len(ended)} pages")

    records = [r for r in candidates if r["janCode"]]
    note = ""
    if not records:
        note = (f"サッポロビール公式サイトは JAN コードを掲載していないため登録0件"
                f"（公式ページで缶 {len(candidates)} 件の容量・度数・カロリーは確認）。")
    elif len(records) < len(candidates):
        note = f"公式ページに JAN がある缶のみ {len(records)}/{len(candidates)} 件。"
    collect.last_candidates = candidates  # official facts without JAN, for inspection
    return {"records": records, "pageErrors": page_errors, "note": note}


if __name__ == "__main__":
    import json

    out = collect(Fetcher(cache_dir=sys.argv[1] if len(sys.argv) > 1 else None))
    cands = getattr(collect, "last_candidates", [])
    print(len(out["records"]), "records;", len(cands), "official can entries without JAN;",
          len(out["pageErrors"]), "page errors")
    print(out["note"])
    print(json.dumps(out["records"][:5] or cands[:5], ensure_ascii=False, indent=1))
    if out["pageErrors"]:
        print(json.dumps(out["pageErrors"][:10], ensure_ascii=False, indent=1))
