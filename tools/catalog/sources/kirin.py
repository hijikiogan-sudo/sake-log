"""Kirin Beer (キリンビール) canned alcohol collector.

Discovery
---------
Kirin's consumer product pages (products.kirin.co.jp/alcohol/...) sit behind a
JavaScript age gate, so they are not used. Instead:

1. The public JSON endpoint that powers the www.kirin.co.jp category pages,
   https://products.kirin.co.jp/parts/get_product_search.php?type=1&menu=<menu>,
   lists every current product per brand. Each item's image file name starts
   with Kirin's 6-digit internal code (社内コード), e.g. ``014242b_260707.jpg``.
2. The partner web catalog serves a detail page per internal code at
   https://outer1.kirin.co.jp/kirin/detail/<code>. The bare code gives the
   current published revision; ended products answer "該当の商品は存在しません"
   at any revision. A few live items only answer on an explicit ``_NNN``
   revision, which is only known for codes from the existing catalog. The page
   holds the official name, container, volume, ABV, per-100ml energy and JAN.
3. The listed code is one SKU (usually the 350ml loose can). Sibling SKUs
   (6-packs, 500ml, 250ml...) have neighbouring codes, so the collector walks
   up and down from each can seed while the product name stays in the same
   family.
4. Codes already referenced by beer-save/beer-catalog.js are added as extra
   seeds so older or seasonal items are re-checked too.
5. https://products.kirin.co.jp/parts/products.php (the "new products" strip
   of www.kirin.co.jp) adds the codes of the newest items.
6. New products get new, increasing internal codes, and the product list API
   often lags behind them. So after the seed pass the collector walks forward
   from the highest live code of the beer/RTD range until a long run of unused
   codes. Each month this costs about FORWARD_MISSES requests plus one per new
   code, and finds cans no list mentions yet.

Why many listed codes fail
--------------------------
The www product list keeps showing items after outer1 has withdrawn them:
seasonal/limited cans whose sales period ended (氷結 もも, 秋味, 麒麟特製 和梨…),
renamed products (本麒麟（発泡酒） became 本麒麟（ビール） under a new code) and
imported/craft items the partner catalog does not carry. outer1 then answers
"該当の商品は存在しません" for the bare code and for every ``_NNN`` revision
(checked _000-_015 on samples), so a revision probe does not help. The bare
code fails for a few live items whose newest revision is not public yet
(のどごし<生>: bare fails, _014 works); those stay reachable through the
revision recorded in the existing catalog. outer1's own search (/kirin/search)
only accepts POST form submissions, and the products.kirin.co.jp detail pages
sit behind an age gate, so neither is used.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

try:  # imported as part of a package that also contains common.py
    from .. import common  # type: ignore
except (ImportError, ValueError):
    _here = str(Path(__file__).resolve().parent.parent)
    if _here not in sys.path:
        sys.path.insert(0, _here)
    import common  # noqa: E402

MANUFACTURER = "キリンビール"

SEARCH_API = "https://products.kirin.co.jp/parts/get_product_search.php?type=1&menu={menu}"
DETAIL_URL = "https://outer1.kirin.co.jp/kirin/detail/{code}"
# Menus whose items can be canned alcohol. "nonalcohol" is skipped on purpose.
# Brand cans are scanned for siblings; for the bottle-heavy menus only the
# listed code itself is checked unless it turns out to be a can.
MENUS = ["beer", "craftbeer", "rtd", "whisky_brandy", "shochu", "umeshu", "spirits_liqueur", "wine"]
EXISTING_CATALOG = Path(__file__).resolve().parents[3] / "beer-save" / "beer-catalog.js"

SCAN_LIMIT = 6        # max distance from a seed code
SCAN_MISSES = 1       # tolerated non-family / missing codes in a row
NEW_API = "https://products.kirin.co.jp/parts/products.php"
# Forward walk past the newest live code. Published codes are sparse (a gap of
# ~80 unused codes was seen between two new items), so the stop rule is generous.
FORWARD_RANGE = (10000, 100000)   # beer / RTD / highball codes; wine etc. use 4xxxxx
FORWARD_MISSES = 120              # stop after this many missing codes in a row
FORWARD_LIMIT = 600               # hard cap on codes walked forward per run
RECENT_WINDOW = 400               # seeds this close to the newest seed code...
RECENT_MISSES = 3                 # ...tolerate this many gaps when scanning neighbours
SIZE_RE = re.compile(r"\s*\d+(?:\.\d+)?\s*ml.*$", re.I)
DISCONTINUED_RE = re.compile(r"販売終了|終売|製造終了")


def nfkc(text):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text or "")).strip()


def clean_brand(raw):
    text = re.sub(r"<[^>]+>|[®™]", "", raw or "")
    text = re.sub(r"\((?:R|TM)\)", "", nfkc(text))
    text = re.sub(r"\([^)]*\)|<[^>]*>|＜[^＞]*＞", "", text)  # readings like (カラダフリー)
    text = re.sub(r"^(?:キリン|KIRIN)\s+", "", text).strip()
    return text


def base_name(name):
    """Official name without size/packaging/campaign words, e.g. 'キリン 氷結 グレープフルーツ'.

    Campaign revisions carry names such as
    '「いいオフ、いい時間♪当たる!」キャンペーン(全数切替)淡麗グリーンラベル350ml缶' or
    '26年8月 キリン一番搾り ホワイトビール クローズドキャンペーン 350ml缶『…』'.
    """
    full = nfkc(name)
    text = re.sub(r"『[^』]*』|「[^」]*」", " ", full)
    text = SIZE_RE.sub("", text)
    text = re.sub(r"^\s*\d+年\d+月\s*", "", text)
    if "キャンペーン" in text:
        before, after = text.rsplit("キャンペーン", 1)
        after = re.sub(r"^[\s)\]】]*", "", after)
        after = re.sub(r"^\([^)]*\)", "", after).strip()
        text = after if after else re.sub(r"\S*$", "", before)
    text = re.sub(r"\([^)]*(?:切替|キャンペーン)[^)]*\)", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\((?:R|TM)\)", "", text)
    return text or SIZE_RE.sub("", full).strip() or full


def family(name):
    text = base_name(name)
    text = re.sub(r"「[^」]*」|\([^)]*\)", "", text)
    return re.sub(r"[\s・]", "", text)


def same_family(a, b):
    return bool(a and b) and (a == b or a.startswith(b) or b.startswith(a))


def field(text, label):
    m = re.search(r"(?:^|\| )" + re.escape(label) + r"\| ([^|]*)", text)
    return m.group(1).strip() if m else None


def parse_detail(markup, url):
    """Return a dict of facts, or None when the code does not exist."""
    text = common.page_text(markup)
    if "該当の商品は存在しません" in text or "商品名|" not in text:
        return None
    name = field(text, "商品名") or ""
    info = {
        "url": url,
        "rawName": name,
        "name": nfkc(name),
        "category": field(text, "カテゴリー") or "",
        "container": field(text, "容器") or "",
        "volume": common.number(field(text, "バラ容量")),
        "packing": field(text, "包装形態") or "",
        "alcohol": field(text, "アルコール分"),
        "tax": field(text, "酒税区分") or "",
        "note": field(text, "詳細備考") or "",
        "jan": None,
        "kcal100": None,
        "discontinued": bool(DISCONTINUED_RE.search(text.split("【コード類とサイズ】")[0])),
    }
    codes = re.search(r"【コード類とサイズ】\| (\S+)\| \S+\| JANコード\| (\d+)", text)
    if codes and codes.group(1) == "バラ":
        info["jan"] = common.valid_jan(codes.group(2))
    unit = field(text, "表示単位") or ""
    energy = field(text, "エネルギー")
    if energy and "kcal" in energy and "100ml" in nfkc(unit):
        info["kcal100"] = common.number(energy)
    return info


def categorize(info):
    cat, tax, name = info["category"], info["tax"], info["name"]
    if "ハイボール" in name or "ウイスキー" in cat:
        return "highball"
    if cat == "ビール" and "ビール" in tax:
        return "beer"
    if cat in ("ビール", "発泡酒", "海外ブランドビール", "ビール・発泡酒") or "発泡酒" in tax:
        return "beer" if "ビール" == tax else "happoshu"
    if "焼酎" in cat:
        return "shochu"
    if "ワイン" in cat and "サワー" not in name:
        return "wine"
    if "チューハイ" in cat or "カクテル" in cat or "リキュール" in cat or "梅酒" in cat:
        return "chuhai"
    return common.guess_category(cat, tax, name)


def flavor_of(base, brand, category):
    if category not in ("chuhai", "highball"):
        return ""
    core = brand.replace(" ", "")
    squashed = base.replace(" ", "")
    idx = squashed.find(core) if core else -1
    if idx < 0:
        return ""
    # Map the position back onto the spaced string by counting non-space chars.
    count, cut = 0, len(base)
    for i, ch in enumerate(base):
        if ch != " ":
            if count == idx + len(core):
                cut = i
                break
            count += 1
    rest = base[cut:]
    rest = re.sub(r"ALC\.?\s*\d+(?:\.\d+)?\s*%|\(期間限定\)", " ", rest)
    rest = re.sub(r"\s+", " ", rest).strip()
    return "" if rest in ("ハイボール",) else rest


def brand_for(name, brands, fallback=""):
    squashed = nfkc(name).replace(" ", "")
    best = ""
    for b in brands:
        core = b.replace(" ", "")
        if core and core in squashed and len(core) > len(best.replace(" ", "")):
            best = b
    if best:
        return best
    if fallback:
        return fallback
    parts = base_name(name).split(" ")
    if parts and parts[0] in ("キリン", "KIRIN") and len(parts) > 1:
        return parts[1]
    return parts[0] if parts else ""


def to_record(info, brand):
    volume = int(info["volume"]) if info["volume"] else None
    kcal = None
    if info["kcal100"] is not None and volume:
        kcal = common.tidy_number(info["kcal100"] * volume / 100)
    base = base_name(info["name"])
    category = categorize(info)
    return {
        "manufacturer": MANUFACTURER,
        "brand": brand,
        "productName": base,
        "flavor": flavor_of(base, brand, category),
        "category": category,
        "volumeMl": volume,
        "alcoholPercent": common.tidy_number(common.number(info["alcohol"])),
        "caloriesKcal": kcal,
        "sugarGrams": None,
        "janCode": info["jan"],
        "source": info["url"],
        "discontinued": info["discontinued"],
    }


def existing_codes():
    """{code: 'code_rev'} for detail pages referenced by the existing catalog."""
    try:
        text = EXISTING_CATALOG.read_text(encoding="utf-8")
    except OSError:
        return {}
    found = {}
    for code, rev in re.findall(r"outer1\.kirin\.co\.jp/kirin/detail/(\d{6})(_\d+)?", text):
        found.setdefault(code, code + rev)
    return found


def collect(fetcher, log=print):
    """Return {"records": [...], "pageErrors": [{"url":..., "error":...}], "note": "optional short text"}"""
    page_errors = []
    seeds = {}  # code -> {"brand": str, "scan": bool}
    brands = set()
    api_ok = 0
    for menu in MENUS:
        url = SEARCH_API.format(menu=menu)
        try:
            data = json.loads(fetcher.get_text(url))
        except common.Blocked:
            raise
        except Exception as e:  # noqa: BLE001
            page_errors.append({"url": url, "error": str(e)[:200]})
            continue
        api_ok += 1
        groups = data.get("product_info") or []
        for group in groups if isinstance(groups, list) else []:
            for brand_raw, items in (group or {}).items():
                brand = clean_brand(brand_raw)
                if menu != "craftbeer":  # its keys are product names, not lines
                    brands.add(brand)
                for item in items or []:
                    m = re.search(r"/images/(\d{6})", item.get("img") or "")
                    if m and m.group(1) not in seeds:
                        seeds[m.group(1)] = {"brand": brand, "scan": True}
    if not api_ok:
        log("kirin: product list API unavailable; falling back to known codes only")
    try:  # "new products" strip: [{"soft": [...], "alc": [{"img": ..., "name": ...}]}]
        data = json.loads(fetcher.get_text(NEW_API))
        for group in data if isinstance(data, list) else []:
            for item in (group or {}).get("alc") or []:
                m = re.search(r"/images/(\d{6})", item.get("img") or "")
                if m:
                    seeds.setdefault(m.group(1), {"brand": "", "scan": True})
    except common.Blocked:
        raise
    except Exception as e:  # noqa: BLE001
        page_errors.append({"url": NEW_API, "error": str(e)[:200]})
    known = existing_codes()
    for code in sorted(known):
        seeds.setdefault(code, {"brand": "", "scan": True})
    log(f"kirin: {len(seeds)} seed codes ({len(known)} from existing catalog)")
    if not seeds:
        return {"records": [], "pageErrors": page_errors, "note": "no product codes discovered"}

    pages = {}  # code -> info or None

    def get(code):
        if code in pages:
            return pages[code]
        # The bare code serves the current published revision. Some live
        # products (e.g. a renewal that is not yet published) only answer on
        # an explicit revision, so retry with the one the old catalog used.
        pages[code] = None
        for ident in dict.fromkeys([code, known.get(code, code)]):
            url = DETAIL_URL.format(code=ident)
            try:
                pages[code] = parse_detail(fetcher.get_text(url), url)
            except common.Blocked:
                raise
            except Exception as e:  # noqa: BLE001
                page_errors.append({"url": url, "error": str(e)[:200]})
            if pages[code] is not None:
                break
        if len(pages) % 50 == 0:
            log(f"kirin: {len(pages)} detail pages checked")
        return pages[code]

    lo, hi = FORWARD_RANGE
    in_range = [int(c) for c in seeds if lo <= int(c) < hi]
    recent_floor = (max(in_range) - RECENT_WINDOW) if in_range else hi

    owner = {}  # code -> brand of the seed that reached it
    for code in sorted(seeds):
        seed = seeds[code]
        info = get(code)
        if info is None:
            continue
        owner.setdefault(code, seed["brand"])
        if "缶" not in info["container"] or not seed["scan"]:
            continue
        fam = family(info["name"])
        # Around the newest codes, unlisted products sit between listed ones
        # (e.g. 麒麟特製 ビターオレンジサワー three codes below 氷結無糖 和梨), so
        # tolerate a few more gaps there.
        allowed = RECENT_MISSES if int(code) >= recent_floor else SCAN_MISSES
        for step in (1, -1):
            misses = 0
            for dist in range(1, SCAN_LIMIT + 1):
                n = int(code) + step * dist
                if n <= 0:
                    break
                ncode = f"{n:06d}"
                other = get(ncode)
                if other is not None and same_family(fam, family(other["name"])):
                    owner.setdefault(ncode, seed["brand"])
                    misses = 0
                else:
                    if other is not None:  # a different product; still a live page
                        owner.setdefault(ncode, "")
                    misses += 1
                    if misses > allowed:
                        break

    # New products receive the next free internal codes, often weeks before the
    # product list shows them. Walk forward from the newest live code.
    live = [int(c) for c, info in pages.items() if info is not None and lo <= int(c) < hi]
    forward = {"from": None, "checked": 0, "found": 0}
    if live:
        n = max(live)
        forward["from"] = f"{n:06d}"
        misses = 0
        while misses < FORWARD_MISSES and forward["checked"] < FORWARD_LIMIT and n + 1 < hi:
            n += 1
            ncode = f"{n:06d}"
            fresh = ncode not in pages
            info = get(ncode)
            forward["checked"] += fresh
            if info is None:
                misses += 1
                continue
            misses = 0
            if ncode not in owner:
                owner[ncode] = ""
                forward["found"] += 1
    log(f"kirin: forward walk from {forward['from']}: {forward['checked']} codes checked, "
        f"{forward['found']} new live codes")

    records, seen = [], {}
    skipped = {"notCan": 0, "pack": 0, "nonAlcohol": 0, "noJan": 0}
    for code in sorted(owner):
        info = pages.get(code)
        if not info:
            continue
        if "缶" not in info["container"]:
            skipped["notCan"] += 1
            continue
        if info["packing"] and info["packing"] != "バラ":
            skipped["pack"] += 1
            continue
        abv = common.number(info["alcohol"])
        if abv is None or abv < 0.5:
            skipped["nonAlcohol"] += 1
            continue
        if not info["jan"] or not info["volume"]:
            skipped["noJan"] += 1
            continue
        brand = brand_for(info["name"], brands, owner.get(code, ""))
        record = to_record(info, brand)
        if record["janCode"] in seen:
            # Same can listed twice (e.g. campaign revision); keep the current one.
            prev = seen[record["janCode"]]
            if prev["discontinued"] and not record["discontinued"]:
                records[records.index(prev)] = record
                seen[record["janCode"]] = record
            continue
        seen[record["janCode"]] = record
        records.append(record)

    note = (f"{len(seeds)} seeds, {len(pages)} detail pages, forward walk {forward['checked']} codes "
            f"({forward['found']} new); skipped " + ", ".join(f"{k}={v}" for k, v in skipped.items()))
    log("kirin: " + note)
    return {"records": records, "pageErrors": page_errors, "note": note}


if __name__ == "__main__":
    cache = sys.argv[1] if len(sys.argv) > 1 else None
    result = collect(common.Fetcher(cache_dir=cache), log=lambda m: print(m, file=sys.stderr))
    print(json.dumps({
        "count": len(result["records"]),
        "pageErrors": len(result["pageErrors"]),
        "note": result.get("note"),
        "sample": result["records"][:5],
    }, ensure_ascii=False, indent=2))
