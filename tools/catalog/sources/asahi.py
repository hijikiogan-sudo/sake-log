"""Asahi Beer: canned products from www.asahibeer.co.jp product pages.

Category page -> brand pages -> product detail pages. Each detail page lists
every container with its single-unit JAN, and one 100ml nutrition table.
"""
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import Blocked, links, number, page_text, tidy_number, valid_jan  # noqa: E402

MANUFACTURER = "アサヒビール"
BASE = "https://www.asahibeer.co.jp/products/"
CATEGORIES = {
    "beer": None,  # decided per page: beer / happoshu
    "sour": "chuhai",
    "shochu": None,
    "whisky_brandy/canned_hiball": "highball",
}
GENERIC = {"商品情報TOP", "ビール類", "ビール", "発泡酒", "新ジャンル", "チューハイ・カクテル", "焼酎・梅酒",
           "ウイスキー・ブランデー", "缶ハイボール", "ハイボール缶", "ノンアルコール", "ワイン"}


def collect(fetcher, log=print):
    records, errors, seen_pages = [], [], set()
    for path, fixed_category in CATEGORIES.items():
        top = BASE + path + "/"
        try:
            markup = fetcher.get_text(top)
        except Blocked:
            raise
        except Exception as e:
            errors.append({"url": top, "error": str(e)})
            continue
        brand_pages = links(markup, top, re.escape(top) + r"[^?]+")
        for brand_url in brand_pages:
            for url, page in _pages(fetcher, brand_url, seen_pages, errors):
                records.extend(_parse(page, url, fixed_category))
        log(f"  asahi {path}: {len(brand_pages)} pages, {len(records)} records so far")
    unique = {}
    for r in records:
        unique.setdefault(r["janCode"], r)
    return {"records": list(unique.values()), "pageErrors": errors}


def _pages(fetcher, brand_url, seen, errors):
    """The brand page itself plus the product detail pages it links to."""
    queue = [brand_url]
    folder = brand_url.rsplit("/", 1)[0] + "/"
    while queue:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            markup = fetcher.get_text(url)
        except Blocked:
            raise
        except Exception as e:
            errors.append({"url": url, "error": str(e)})
            continue
        yield url, markup
        if url == brand_url:
            queue += [u for u in links(markup, url, re.escape(folder) + r"[0-9A-Z]{5}\.html$") if u not in seen]


def _parse(markup, url, fixed_category):
    text = page_text(markup)
    # The <title> reads "<product> | <category> | 商品情報 | アサヒビール".
    title = re.search(r"(?s)<title>(.*?)</title>", markup)
    name = html.unescape(title.group(1)).split("|")[0] if title else ""
    name = re.sub(r"\s+", " ", name.replace("　", " ")).strip()
    if not name or name in GENERIC:
        return []
    crumbs = _breadcrumb(text, name)
    brand = next((c for c in reversed(crumbs) if c not in GENERIC and c != name), name)
    brand = re.sub(r"^アサヒ\s*", "", brand).strip() or brand
    category = fixed_category or _category(crumbs, name)
    table = text[text.find("表示単位：100ml当たり"):] if "表示単位：100ml当たり" in text else ""
    alcohol = number(_cell(table, "アルコール分"))
    kcal100 = number(_cell(table, "エネルギー"))
    discontinued = any(w in text for w in ("販売終了", "終売", "製造終了"))
    found = []
    for container, volume, code in re.findall(r"容器：([^|]+)\| 内容量：([\d.,]+)ml\| JANコード\| 単品：(\d+)", text):
        jan = valid_jan(code)
        if "缶" not in container or not jan or alcohol is None or alcohol < 0.5:
            continue
        volume = int(number(volume.replace(",", "")))
        found.append({
            "manufacturer": MANUFACTURER, "brand": brand, "productName": name, "flavor": "",
            "category": category, "volumeMl": volume, "alcoholPercent": tidy_number(alcohol),
            "caloriesKcal": tidy_number(kcal100 * volume / 100) if kcal100 is not None else None,
            "sugarGrams": None, "janCode": jan, "source": url, "discontinued": discontinued,
        })
    return found


def _breadcrumb(text, name):
    start = text.find("商品情報TOP")
    if start < 0:
        return []
    cells = [c.strip() for c in text[start:start + 400].split("|")]
    return cells[:cells.index(name)] if name in cells else cells[:4]


def _category(crumbs, name):
    joined = " ".join(crumbs + [name]).replace(" ", "")
    if any(w in joined for w in ("発泡酒", "新ジャンル", "クリアアサヒ", "スタイルフリー")) or "オフ" in name:
        return "happoshu"
    if "ハイボール" in joined:
        return "highball"
    if "焼酎" in joined:
        return "shochu"
    if "チューハイ" in joined or "サワー" in joined:
        return "chuhai"
    return "beer"


def _cell(text, label):
    m = re.search(re.escape(label) + r"\| ([^|]+)", text)
    return m.group(1) if m else None


if __name__ == "__main__":
    import json
    from common import Fetcher
    result = collect(Fetcher(cache_dir=sys.argv[1] if len(sys.argv) > 1 else None))
    print(len(result["records"]), "records,", len(result["pageErrors"]), "errors")
    print(json.dumps(result["records"][:5], ensure_ascii=False, indent=1))
