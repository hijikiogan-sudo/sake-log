"""Takara Shuzo (宝酒造) canned alcoholic products from the official product database.

Discovery: the category index (tkr-shohin/cmn_c_list.php) carries every brand
as a radio button grouped under its category.  Each brand has a product list
(cmn_p_list.php?p_BrandID=N) linking to detail pages (cmn_p_detail.php?p_prodid=N)
that state 容器 (container), 容量, JANコード, アルコール度数 and nutrition facts
(per 100ml, or per can when the header says 1本当たり).

Every product of the ソフトアルコール飲料 category is opened (that is where the
cans live); in the other categories only products whose listing name mentions a
can are opened, which keeps the crawl small.  Only pages whose 容器 is 缶 become
records.
"""
import html
import re
import sys
import unicodedata
from pathlib import Path

try:
    from .. import common  # tools.catalog imported as a package
except (ImportError, ValueError):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    import common  # noqa: E402

MANUFACTURER = "宝酒造"
BASE = "https://www.takarashuzo.co.jp/tkr-shohin/"
INDEX = BASE + "cmn_c_list.php"
SOFT_ALCOHOL_CATEGORY = "4"
CAN_HINT = re.compile(r"缶|can|CAN|Can")
DISCONTINUED = re.compile(r"販売終了|終売|製造終了")


def norm(text):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text or "")).strip()


def _brands(markup):
    """[(category_id, category_name, brand_id, brand_name)] from the index page."""
    out = []
    for block in re.split(r'(?=<input type="radio" name="list")', markup)[1:]:
        cat = re.match(r'<input type="radio" name="list" value="(\d+)"[^>]*>(?:&nbsp;|\s)*([^<]*)', block)
        if not cat:
            continue
        for bid, bname in re.findall(r'name="brand" value="(\d+)">(?:&nbsp;|\s)*([^<]*)', block):
            out.append((cat.group(1), norm(cat.group(2)), bid, norm(html.unescape(bname))))
    return out


def _products(markup):
    """[(prodid, listing name)] from a brand product list."""
    found = {}
    for m in re.finditer(r'p_prodid=(\d+)["\'][^>]*>(.*?)</a>', markup, re.S):
        name = norm(common.page_text(m.group(2)))
        if name or m.group(1) not in found:
            found[m.group(1)] = name or found.get(m.group(1), "")
    if not any(found.values()):
        # Names may sit outside the anchor; fall back to text near each link.
        for m in re.finditer(r'p_prodid=(\d+)', markup):
            tail = common.page_text(markup[m.end():m.end() + 600]).split("| ")
            found[m.group(1)] = norm(tail[0]) if tail else ""
    return list(found.items())


def _dl(markup):
    """Flatten <dt>/<dd> pairs into a dict (first occurrence wins)."""
    out = {}
    for dt, dd in re.findall(r"<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", markup, re.S):
        key = norm(common.page_text(dt))
        dd = re.sub(r"(?is)<script\b.*?</script>", "", dd)
        out.setdefault(key, norm(common.page_text(dd)))
    return out


def _category(brand, name, category_name):
    text = f"{brand} {name}"
    if "焼酎ハイボール" in text or "ソフトアルコール" in category_name:
        return "chuhai"
    if "ウイスキー" in category_name:
        return "highball"
    if "焼酎" in category_name:
        return "shochu"
    if "リキュール" in category_name:
        return "chuhai"
    return common.guess_category(brand, name)


def parse_detail(markup, url, brand, category_name):
    """Return a record dict, or None (with a reason) when the page is not a can."""
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", markup, re.S)
    if not h1:
        raise ValueError("no product name")
    full = norm(common.page_text(h1.group(1)))
    facts = _dl(markup)
    container = facts.get("容器", "")
    if "缶" not in container:
        return None, f"container {container or '?'}"
    volume = common.number(facts.get("容量"))
    unit = facts.get("容量", "")
    if volume and re.search(r"(?i)\d\s*l\b|リットル", unit) and not re.search(r"(?i)ml", unit):
        volume *= 1000
    alcohol = common.number(facts.get("アルコール度数"))
    if not alcohol or "ノンアル" in full or "ノンアル" in brand:
        return None, "non-alcoholic"
    jan = common.valid_jan(facts.get("JANコード"))
    if not jan:
        raise ValueError(f"no valid JAN ({facts.get('JANコード')!r})")
    if not volume:
        raise ValueError("no volume")

    # Strip the trailing size suffix: "タカラcanチューハイ〈レモン〉250ML" -> "...〈レモン〉"
    name = re.sub(r"\s*[\d.]+\s*(?:ML|ml|mL|L)\s*(?:缶|×\s*\d+.*)?$", "", full).strip() or full
    flavors = re.findall(r"〈([^〉]+)〉", name)
    flavor = flavors[-1] if flavors else ""

    per_can = 1.0
    unit_hdr = re.search(r'data-unit="([^"]*)"[^>]*>\s*栄養成分', markup)
    unit_text = unit_hdr.group(1) if unit_hdr else ""
    if "100ml" in unit_text.lower():
        per_can = volume / 100.0
    elif not re.search(r"1本|1缶|本当たり|缶当たり", unit_text):
        per_can = None  # unknown basis: leave nutrition empty
    kcal = common.number(next((v for k, v in facts.items() if k.startswith("エネルギー")), None))
    sugar = common.number(next((v for k, v in facts.items() if k.startswith("糖質")), None))
    calories = common.tidy_number(kcal * per_can) if kcal is not None and per_can else None
    sugar_g = common.tidy_number(sugar * per_can) if sugar is not None and per_can else None

    return {
        "manufacturer": MANUFACTURER,
        "brand": brand,
        "productName": name,
        "flavor": flavor,
        "category": _category(brand, name, category_name),
        "volumeMl": int(round(volume)),
        "alcoholPercent": common.tidy_number(alcohol),
        "caloriesKcal": calories,
        "sugarGrams": sugar_g,
        "janCode": jan,
        "source": url,
        "discontinued": bool(DISCONTINUED.search(common.page_text(markup))),
    }, None


def collect(fetcher, log=print):
    """Return {"records": [...], "pageErrors": [{"url":..., "error":...}], "note": "optional short text"}"""
    records, errors, seen_jan, seen_prod = [], [], set(), set()
    index = fetcher.get_text(INDEX)  # Blocked propagates: the whole site is unavailable
    brands = _brands(index)
    if not brands:
        raise ValueError("brand index not found on " + INDEX)
    skipped = 0
    for cat_id, cat_name, brand_id, brand_name in brands:
        list_url = f"{BASE}cmn_p_list.php?p_BrandID={brand_id}"
        try:
            products = _products(fetcher.get_text(list_url))
        except common.Blocked:
            raise
        except Exception as e:
            errors.append({"url": list_url, "error": str(e)})
            continue
        for prodid, listing_name in products:
            if prodid in seen_prod:
                continue
            if cat_id != SOFT_ALCOHOL_CATEGORY and not CAN_HINT.search(listing_name):
                continue
            seen_prod.add(prodid)
            url = f"{BASE}cmn_p_detail.php?p_prodid={prodid}"
            try:
                record, why = parse_detail(fetcher.get_text(url), url, brand_name, cat_name)
            except common.Blocked:
                raise
            except Exception as e:
                errors.append({"url": url, "error": str(e)})
                continue
            if not record:
                skipped += 1
                continue
            if record["janCode"] in seen_jan:
                continue
            seen_jan.add(record["janCode"])
            records.append(record)
        log(f"[takara] {brand_name}: {len(products)} listed, {len(records)} cans so far")
    note = (f"{len(brands)} brands, {len(seen_prod)} detail pages opened, "
            f"{skipped} non-can/non-alcoholic skipped")
    return {"records": records, "pageErrors": errors, "note": note}


if __name__ == "__main__":
    import json
    cache = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
    result = collect(common.Fetcher(cache_dir=cache), log=lambda m: print(m, file=sys.stderr))
    print(len(result["records"]), "records;", len(result["pageErrors"]), "page errors;", result["note"])
    print(json.dumps(result["records"][:5], ensure_ascii=False, indent=2))
    if result["pageErrors"]:
        print(json.dumps(result["pageErrors"][:10], ensure_ascii=False, indent=2))
