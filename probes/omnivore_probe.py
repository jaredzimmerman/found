#!/usr/bin/env python3
"""Probe Omnivore Books upcoming events with Playwright.

The static HTML is a Shopify collection page that renders its event list
client-side. This probe uses Playwright to load the page, wait for network
idle, then extracts any visible event listings.

We check for:
- Presence of dated event blocks (month/day/year patterns)
- Any JSON-LD Event objects
- Visible text lines that look like events (title, date, time, price)
"""
import json
import re
import sys
from playwright.sync_api import sync_playwright

URL = "https://omnivorebooks.myshopify.com/collections/upcoming-events"

def extract_events(page):
    """Extract event information from the rendered page."""
    # Get all visible text
    text = page.inner_text("body")
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    
    # Look for JSON-LD Event objects
    ld_json = page.evaluate("""() => {
        const out = [];
        document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
            try { out.push(JSON.parse(el.textContent)); } catch (e) {}
        });
        return out;
    }""")
    
    # Look for elements that might contain event info
    event_candidates = page.evaluate("""() => {
        const results = [];
        // Look for common patterns: divs with event/product in class or data attributes
        const selectors = [
            '[class*="event"]',
            '[class*="product"]',
            '[data-event]',
            '.product-item',
            '.grid-product',
            '.collection-item'
        ];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                const txt = el.innerText.trim();
                if (txt && txt.length > 10 && txt.length < 500) {
                    results.push({selector: sel, text: txt.slice(0,200)});
                }
            });
        });
        return results;
    }""")
    
    return {
        "visible_text_lines": len(lines),
        "sample_lines": lines[:20],
        "jsonld_events": ld_json,
        "event_candidates": event_candidates[:10]
    }

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        
        print(f"Loading {URL}")
        page.goto(URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)  # extra settle time
        
        # Take screenshot for reference
        page.screenshot(path="/tmp/omnivore_books.png", full_page=False)
        
        # Extract event data
        data = extract_events(page)
        
        print("=" * 60)
        print("OMNIVORE BOOKS UPCOMING EVENTS PROBE")
        print("=" * 60)
        print(f"URL: {URL}")
        print(f"Visible text lines: {data['visible_text_lines']}")
        print()
        print("First 20 visible lines:")
        for i, line in enumerate(data['sample_lines']):
            print(f"  {i+1:2}: {line}")
        print()
        print(f"JSON-LD Event objects found: {len(data['jsonld_events'])}")
        if data['jsonld_events']:
            for i, event in enumerate(data['jsonld_events'][:3]):
                print(f"  Event {i+1}: {json.dumps(event, indent=2)[:200]}...")
        print()
        print("Event candidate elements:")
        for cand in data['event_candidates']:
            print(f"  [{cand['selector']}] {cand['text']}")
        print()
        print(f"Screenshot saved to: /tmp/omnivore_books.png")
        
        browser.close()

if __name__ == "__main__":
    main()