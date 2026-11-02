"""Shared helpers for the product catalog collectors.

Every request goes through Fetcher, which identifies itself honestly, obeys
robots.txt and waits between requests to the same host. A site that refuses
access is reported as unavailable; nothing here tries to get around it.
"""
import html
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path

USER_AGENT = "KanLogCatalog/1.0 (+https://github.com/hijikiogan-sudo/sake-log)"


class Blocked(Exception):
    """The site refused access (robots.txt or HTTP 401/403)."""


class Fetcher:
    def __init__(self, delay=1.5, timeout=30, retries=2, cache_dir=None):
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self._robots = {}
        self._last = {}

    def _allowed(self, url):
        parts = urllib.parse.urlsplit(url)
        root = f"{parts.scheme}://{parts.netloc}"
        if root not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                req = urllib.request.Request(root + "/robots.txt", headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    rp.parse(res.read().decode("utf-8", "replace").splitlines())
            except urllib.error.HTTPError as e:
                # 401/403 on robots.txt means "keep out"; 404 means no rules.
                rp.parse(["User-agent: *", "Disallow: /"] if e.code in (401, 403) else [])
            except Exception:
                rp.parse([])
            self._robots[root] = rp
        return self._robots[root].can_fetch(USER_AGENT, url)

    def _wait(self, host):
        gap = time.monotonic() - self._last.get(host, 0)
        if gap < self.delay:
            time.sleep(self.delay - gap)
        self._last[host] = time.monotonic()

    def get_bytes(self, url):
        cached = self._cache_path(url)
        if cached and cached.exists():
            return cached.read_bytes(), None
        if not self._allowed(url):
            raise Blocked(f"robots.txt disallows {url}")
        host = urllib.parse.urlsplit(url).netloc
        last_error = None
        for attempt in range(self.retries + 1):
            self._wait(host)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "ja"})
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    body = res.read()
                    charset = res.headers.get_content_charset()
                if cached:
                    cached.parent.mkdir(parents=True, exist_ok=True)
                    cached.write_bytes(body)
                return body, charset
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    raise Blocked(f"HTTP Error {e.code}: {e.reason}")
                if e.code == 404:
                    raise
                last_error = e
            except Exception as e:  # timeouts, resets
                last_error = e
            time.sleep(2 * (attempt + 1))
        raise last_error

    def get_text(self, url):
        body, charset = self.get_bytes(url)
        return decode(body, charset)

    def _cache_path(self, url):
        if not self.cache_dir:
            return None
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", url)[-180:]
        return self.cache_dir / safe


def decode(body, charset=None):
    head = body[:4000].decode("ascii", "ignore")
    meta = re.search(r'charset=["\']?([A-Za-z0-9_-]+)', head)
    for enc in filter(None, [charset, meta and meta.group(1), "utf-8", "cp932"]):
        enc = {"shift_jis": "cp932", "sjis": "cp932", "x-sjis": "cp932"}.get(enc.lower(), enc)
        try:
            return body.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return body.decode("utf-8", "replace")


def page_text(markup):
    """Flatten HTML into '| '-separated text cells, keeping table/list order."""
    markup = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", markup)
    markup = re.sub(r"(?s)<!--.*?-->", " ", markup)
    text = html.unescape(re.sub(r"<[^>]+>", "|", markup))
    text = re.sub(r"[ \t\r\n　]+", " ", text)
    return re.sub(r"(\s*\|\s*)+", "| ", text).strip("| ")


def links(markup, base, pattern):
    found = []
    for href in re.findall(r'href=["\']([^"\'#]+)', markup):
        url = urllib.parse.urljoin(base, html.unescape(href))
        if re.search(pattern, url) and url not in found:
            found.append(url)
    return found


def number(value):
    if value is None:
        return None
    m = re.search(r"\d+(?:\.\d+)?", str(value).translate(str.maketrans("０１２３４５６７８９．", "0123456789.")))
    return float(m.group()) if m else None


def tidy_number(value):
    if value is None:
        return None
    value = round(float(value), 1)
    return int(value) if value.is_integer() else value


def valid_jan(code):
    code = re.sub(r"\D", "", str(code or ""))
    if len(code) not in (8, 13):
        return None
    digits = [int(c) for c in code]
    body, check = digits[:-1], digits[-1]
    weights = [3, 1] if len(code) == 8 else [1, 3]
    total = sum(d * weights[i % 2] for i, d in enumerate(body))
    return code if (10 - total % 10) % 10 == check else None


def guess_category(*texts):
    text = " ".join(t or "" for t in texts)
    rules = [
        ("highball", ["ハイボール", "水割", "ウイスキー"]),
        ("happoshu", ["発泡酒", "新ジャンル", "リキュール（発泡性）", "その他の醸造酒（発泡性）", "麦とホップ", "金麦", "本麒麟", "クリアアサヒ", "のどごし", "淡麗", "スタイルフリー"]),
        ("wine", ["ワイン"]),
        ("shochu", ["焼酎", "ホッピー"]),
        ("chuhai", ["チューハイ", "サワー", "酎ハイ", "カクテル", "レモン", "氷結", "ハイ"]),
        ("beer", ["ビール", "ドラフト", "エール", "ラガー"]),
    ]
    for category, words in rules:
        if any(w in text for w in words):
            return category
    return "chuhai"
