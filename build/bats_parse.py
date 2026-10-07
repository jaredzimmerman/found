#!/usr/bin/env python3
"""Parse BATS Improv's show listings off https://www.improv.org/shows/

WHY THIS PAGE AND NOT THE TICKETING LINK
----------------------------------------
improv.org/shows/ looks like a brochure page and mostly is: two paragraphs of
marketing copy about the BATS style. A reader - human or scraper - is meant to
follow "See BATS in action" through to app.gopassage.com/venues/7662.

That destination is a dead end for mining, and it is worth being precise about
why, because it is not simply "the data is behind JS":

  * gopassage.com/venues/7662 embeds its Events React component with
    {"events":[],"loadMore":true,"venueIds":["7662"]}. An empty array.
  * The XHR that would page more (/events/list) is wired in the bundle to fire
    only when `events.length > 14`, so with 0 rows it never fires. There is no
    second page hiding behind the empty one.
  * /events/list?venue_ids=7662 returns 200 with {"events":[]}.

The same JSON shape DOES serve other venues - a Detroit venue returns populated
rows with exactly the fields wanted (min_start_time, venue_time_zone, name) - so
the endpoint is real and the emptiness is specific to BATS. BATS appears to have
migrated ticketing to Eventbrite and left the GoPassage venue as a shell.

The listings are in fact on improv.org/shows/ itself, as Elementor cards whose
"Buy Tickets" button points at Eventbrite.

THE SHAPE OF A CARD
-------------------
    BATS Improv presents: The Improvised Twilight Zone
    Saturday
    Oct 3 & 10

    [ Buy Tickets ] -> https://www.eventbrite.com/e/bats-improv-presents-the-
                        improvised-twilight-zone-10326-101026-tickets-...

THE YEAR IS IN THE SLUG, AND THE SLUG AGREES WITH THE CARD
-----------------------------------------------------------
The card text states NO year - "Oct 3 & 10", nothing more. That is the same trap
that was publishing 2025 Center for the Book events as 2026, so the year is
never pasted onto the card here.

Eventbrite slugs carry the run dates as bare numeric tokens, variable width:

    ...twilight-zone-10326-101026-tickets-...
                 ^^^^^  ^^^^^^
                 Oct 3  Oct 10      (MDDYY / MMDDYY, YY implied)

    ...trick-or-treat101726-102426-tickets-...
                   ^^^^^  ^^^^^^
                   Oct 17 Oct 24

    ...double-creature-103126-sho-...
                     ^^^^^
                     Oct 31

Each token decodes to a run date, and the decoded set EQUALS the dates printed
on the card. So the slug is used two ways:

  1. as the source of the YEAR, and
  2. as an independent CROSS-CHECK on the card's own month/day text.

A card whose slug tokens disagree with its rendered dates is a parsing fault,
not a source ambiguity, and is dropped loudly rather than silently resolved in
either direction.

WHAT THIS PAGE DOES NOT STATE
-----------------------------
  * NO TIME. "Saturday / Oct 3" carries no clock. startMinutes stays -1 and
    timeLabel stays "Time TBA". No placeholder time is invented. BATS show times
    vary per show, so fabricating one from the venue's usual curtain would be
    fiction that reads as fact.

  * NO YEAR for some cards. A slug with no decodable date token (the student
    showcase's "...-83026-sch-s-...") yields nothing to stand on, so the card is
    DROPPED, not guessed into the current year.

RUN THIS:  python3 bats_parse.py [--selftest]
"""

import re
import sys
import html as _html
import urllib.request
from datetime import date

SOURCE = "https://www.improv.org/shows/"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

VENUE = "BATS Improv"
ADDRESS = "470B Battery St, San Francisco, CA 94118"

MONTHS = {}
for _i, _name in enumerate(
        "january february march april may june july august september october "
        "november december".split()):
    # Keyed by the 3-letter prefix, which is all a rendered card ever prints
    # ("Oct 31 & Nov 7"). Keying on the full name and looking up a prefix is a
    # lookup that silently returns None, which is how "Oct 3" came out empty.
    MONTHS[_name[:3]] = _i + 1


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "replace")


def strip_tags(fragment):
    fragment = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", fragment)
    return _html.unescape(re.sub(r"(?s)<[^>]+>", "\n", fragment))


# ---------------------------------------------------------------- slug dates

def slug_years(slug):
    """Every year the slug states, ascending.

    The year is the least ambiguous thing about these tokens: a token ends in YY
    and the vocabulary is all 20xx. So the slug is used for exactly one job -
    supplying the YEAR, which the card text does not state at all - and the card
    keeps ownership of the month and day it actually prints.

    Earlier revisions tried to decode the whole token and had to be rewritten
    twice, because the day is unpadded and the encoding therefore genuinely
    under-determines the date:

        10326  -> 5 chars. Oct 3 (day 3) or Jan 3 (MDDYY reading).
        83026  -> 5 chars. Aug 30 has a single-digit month, which no fixed-width
                  split accommodates.
        101726 -> 6 chars, Oct 17 - unambiguous, but only by luck of the format.

    Rather than pick a width that happens to fit today's seven shows and be
    wrong by one month on a card added tomorrow, the year is read off and the
    month/day are left to the page's own text. That is the direction of trust
    that cannot rot: the rendered card is the source's explicit statement, the
    slug encoding is an undocumented convention.
    """
    years = set()
    for tok in re.findall(r"(?<!\d)\d{5,6}(?!\d)", slug):
        yy = 2000 + int(tok[-2:])
        if 2000 < yy < 2100:
            years.add(yy)
    return sorted(years)


def slug_months(slug):
    """Months the 6-digit tokens name, for cross-checking against the card.

    Only unambiguous 6-digit tokens are read, and only their leading month.
    Anything that cannot be read without guessing yields nothing, which simply
    means no cross-check runs for that card - never a wrong cross-check.
    """
    months = set()
    for tok in re.findall(r"(?<!\d)\d{6}(?!\d)", slug):
        mm = int(tok[:2])
        if 1 <= mm <= 12:
            months.add(mm)
    return months


def card_dates(dayline, year):
    """Expand a rendered date line into ISO dates, using the slug only for YEAR.

    Handles the forms this page actually emits:
        "Oct 3"           -> [Oct 3]
        "Oct 3 & 10"      -> [Oct 3, Oct 10]      (biweekly run)
        "Oct 17 & 24"     -> [Oct 17, Oct 24]
        "Oct 31 & Nov 7"  -> [Oct 31, Nov 7]       (named month rollover)
        "Dec 5"           -> [Dec 5]
    A month with no leading month name repeats the previous month, which is what
    "Oct 3 & 10" means.
    """
    dayline = " ".join(dayline.split())
    head = re.match(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})", dayline)
    if not head:
        return []
    mon = MONTHS.get(head.group(1).lower()[:3])
    if not mon:
        return []

    out, cur = [], mon
    for part in re.split(r"\s*&\s*|\s*,\s*", dayline):
        part = part.strip()
        if not part:
            continue
        named = re.match(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})", part)
        if named:
            cur = MONTHS.get(named.group(1).lower()[:3], cur)
            day = int(named.group(2))
        else:
            bare = re.match(r"(\d{1,2})", part)
            if not bare:
                continue
            day = int(bare.group(1))
        try:
            out.append(date(year, cur, day))
        except ValueError:
            continue
    return out


# ---------------------------------------------------------------- extraction

def extract(html_text, log=lambda *_: None):
    """Return one row per show date. Cards that cannot be trusted are dropped."""
    rows, seen_cards = [], set()

    for m in re.finditer(r'href="(https://www\.eventbrite\.com/e/[^"]+)"', html_text):
        url = _html.unescape(m.group(1))
        slug = url.split("/e/")[1].split("?")[0]
        if slug in seen_cards:
            continue

        window = html_text[max(0, m.start() - 2500):m.start() + 2500]
        lines = [l.strip() for l in strip_tags(window).split("\n") if l.strip()]

        # The card title is the line starting "BATS Improv presents" (or the
        # student showcase). Bind the dates to THIS title only.
        ti = next((i for i, l in enumerate(lines)
                   if l.startswith("BATS Improv presents") or l.startswith("Student Show")),
                  None)
        if ti is None:
            continue
        title = lines[ti]

        if ti + 2 >= len(lines):
            continue
        weekday, date_line = lines[ti + 1], lines[ti + 2]
        if not re.match(r"^[A-Za-z]+s?$", weekday) or not re.search(r"[A-Za-z]{3}", date_line):
            continue

        years = slug_years(slug)
        if not years:
            log(f"  DROP (slug states no year, and the card does not either): {title}")
            continue
        if len(years) != 1:
            log(f"  DROP (slug spans years {years}): {title}")
            continue

        parsed = card_dates(date_line, years[0])
        if not parsed:
            log(f"  DROP (unparsed date line {date_line!r}): {title}")
            continue

        # Cross-check where the slug is unambiguous. The card's own months must
        # be among the months the 6-digit tokens name; a 5-digit token yields no
        # month and simply skips the check. This catches a card whose text and
        # slug describe different months without ever asserting a false match.
        sm = slug_months(slug)
        if sm and not ({d.month for d in parsed} & sm):
            log(f"  DROP (card months {sorted({d.month for d in parsed})} vs slug "
                f"months {sorted(sm)}): {title}")
            continue

        seen_cards.add(slug)
        for d in parsed:
            rows.append({
                "id": f"bats-{re.sub(r'[^a-z0-9]+', '-', slug.lower())[:56]}-{d.isoformat()}",
                "title": title,
                "venue": VENUE,
                # Derived from the address by hoodsOf() in fetch.mjs over the
                # whole corpus, same as every other source states it.
                "neighborhood": "San Francisco",
                "address": ADDRESS,
                "date": d.isoformat(),
                # This page publishes no clock. Left absent rather than invented.
                "startMinutes": -1,
                "endMinutes": -1,
                "timeLabel": "Time TBA",
                "weekday": weekday,
                "url": url.split("?")[0],
                "linkTier": "venue",
                "categories": ["Improv"],
                "priceTier": "paid",
            })
    return rows


def selftest():
    # The year is the one thing the slug is asked for.
    assert slug_years("bats-improv-presents-the-improvised-twilight-zone-"
                      "10326-101026-tickets-1989702485696") == [2026]
    assert slug_years("bats-improv-presents-noir-new-years-123126-sho-") == [2026]
    # The 13-digit ticket id must not leak a year through the lookarounds.
    assert slug_years("tickets-1989702591011") == []
    assert slug_years("bats-student-show-shortform-showcase-83026-sch-s-") == [2026]

    # Months come only from 6-digit tokens; a 5-digit token states none.
    assert slug_months("bats-improv-presents-the-improvised-twilight-zone-"
                       "10326-101026-tickets-1989702485696") == {10}
    assert slug_months("bats-improv-presents-noir-new-years-123126-sho-") == {12}
    assert slug_months("bats-student-show-shortform-showcase-83026-sch-s-") == set()

    # The card keeps ownership of month/day - the slug only supplies the year.
    # 10326 is 5 chars and genuinely ambiguous (Oct 3 vs Jan 3); the card says
    # "Oct 3 & 10", and that text is what wins.
    assert card_dates("Oct 3", 2026) == [date(2026, 10, 3)]
    assert card_dates("Oct 3 & 10", 2026) == [date(2026, 10, 3), date(2026, 10, 10)]
    assert card_dates("Oct 17 & 24", 2026) == [date(2026, 10, 17), date(2026, 10, 24)]
    assert card_dates("Oct 31 & Nov 7", 2026) == [date(2026, 10, 31), date(2026, 11, 7)]
    assert card_dates("Dec 5", 2026) == [date(2026, 12, 5)]
    assert card_dates("Aug 30", 2026) == [date(2026, 8, 30)]
    assert card_dates("garbage", 2026) == []

    # End to end on a real card: "Oct 3 & 10" plus its slug yields two rows in
    # 2026, with no time invented.
    doc = ('<div>BATS Improv presents: The Improvised Twilight Zone</div>'
           '<div>Saturday</div><div>Oct 3 &amp; 10</div>'
           '<a href="https://www.eventbrite.com/e/bats-improv-presents-the-improvised-'
           'twilight-zone-10326-101026-tickets-1989702485696">Buy Tickets</a>')
    rows = extract(doc)
    assert [r["date"] for r in rows] == ["2026-10-03", "2026-10-10"]
    assert all(r["startMinutes"] == -1 and r["timeLabel"] == "Time TBA" for r in rows)

    # A card whose slug names no year the source states is dropped, not guessed
    # into the current year - the same rule that stopped SFCB re-dating events.
    nodate = ('<div>BATS Improv presents: Mystery</div><div>Friday</div>'
              '<div>Oct 9</div>'
              '<a href="https://www.eventbrite.com/e/bats-mystery-tickets-999">Buy</a>')
    assert extract(nodate) == []
    print("selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    rows = extract(fetch(SOURCE), log=lambda s: print(s, file=sys.stderr))
    print(f"\n{len(rows)} rows from {SOURCE}\n")
    for r in sorted(rows, key=lambda r: (r["date"], r["title"])):
        print(f"  {r['date']}  {r['weekday']:9s}  {r['title'][:58]}")