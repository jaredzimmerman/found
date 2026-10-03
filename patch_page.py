import re

with open('/var/www/pinkpages.indigokarasu.com/index.html', 'r') as f:
    content = f.read()

# 1. Move priceSlot from time column to meta
# Find the meta block and replace the priceSlot creation with appending to meta
# We'll replace from the comment "// The price sits in the time column..." to the end of the priceSlot creation block
# and also remove the later time.append(t, priceSlot)

# Pattern for the meta block with priceSlot creation
meta_pattern = re.compile(
    r'(\s*// Venue, address and price\. Price is deliberately here rather than in\n\s*// the tag row: it is a fact about the ticket, not a category\.\n\s*const meta = document\.createElement\("div"\);\n\s*meta\.className = "meta";\n\s*if \(e\.venue\) \{\n\s*// Clicking the venue filters to it — it is an affordance, not a link\n\s*// out\. Same affordance as a tag, different axis\.\n\s*const v = document\.createElement\("button"\);\n\s*v\.type = "button";\n\s*v\.className = "venue";\n\s*v\.textContent = e\.venue;\n\s*v\.title = `\$Show everything at \${e\.venue}`;\n\s*v\.onclick = \(\) => \{ state\.venue = e\.venue; applyFilters\(\); openBar\(\); scrollTop\(\); \};\n\s*meta\.append\(v\);\n\s*\}\n\s*if \(e\.address\) \{\n\s*const ad = document\.createElement\("span"\);\n\s*ad\.textContent = e\.address;\n\s*meta\.append\(ad\);\n\s*\}\n\s*)',
    re.MULTILINE
)

# We need to capture the meta block and then insert the price appending after address if present.
# Instead, let's do a more targeted replacement: replace the priceSlot creation lines with nothing,
# and then after the address block, add the price appending.

# First, remove the priceSlot creation lines:
content = re.sub(
    r'\s*// The price sits in the time column, left-aligned under the start time\.\n\s*// It was a chip in the meta row, mixed in with the tags, where it read as\n\s*// a category rather than a fact about the ticket\. Moving it also empties\n\s*// the meta row on a bare "\\\\free" listing, which was leaving an orphan\.\n\s*const priceSlot = document\.createElement\("div"\);\n\s*priceSlot\.className = "time-price";\n\s*if \(e\.priceLabel\) \{\n\s*const pl = document\.createElement\("span"\);\n\s*pl\.className = "price" \(e\.priceTier === "free" \? " free" : ""\);\n\s*pl\.textContent = e\.priceLabel;\n\s*priceSlot\.append\(pl\);\n\s*\}\n',
    '',
    content,
    flags=re.MULTILINE
)

# Now, after the address block, we need to append the price to meta.
# Find the line: '        meta.append(ad);' and after that, insert the price appending.
# We'll do a replacement for the address block to also include price if present.
# Actually easier: after the address block, but before the closing of the meta if? 
# Let's replace the address block with itself plus the price block after it.

# We'll find the pattern for the address block and add after it.
content = re.sub(
    r'(\s*if \(e\.address\) \{\n\s*const ad = document\.createElement\("span"\);\n\s*ad\.textContent = e\.address;\n\s*meta\.append\(ad\);\n\s*\})',
    r'\1\n\s*// Price is a fact about the ticket, not a category.\n\s*if \(e\.priceLabel\) {\n\s*const pl = document.createElement("span");\n\s*pl.className = "price" + (e.priceTier === "free" ? " free" : "");\n\s*pl.textContent = e.priceLabel;\n\s*meta.append(pl);\n\s*}',
    content,
    flags=re.MULTILINE
)

# 2. Remove the time.append(t, priceSlot) line and replace with time.append(t);
content = re.sub(
    r'\s*time\.append\(t, priceSlot\);',
    '      time.append(t);',
    content
)

# 3. Modify the timeLabel to remove spaces around --
# Find the line: '      for (const part of String(e.timeLabel).split(/(\\b(?:AM|PM)\\b)/i)) {'
# and replace with cleaning step.
content = re.sub(
    r'(\s*// Render the time as text, and shrink EVERY meridiem in it — a range has\n\s*// two \(""8 PM -- 2 AM""\), and the previous single-trailing-match approach\n\s*// printed only one, which turned an 8 PM--2 AM show into a false\n\s*// ""8 PM -- 2 PM"". Splitting on every occurrence is the only shape that is\n\s*// correct for both a single time and a range.\n\s*for \(const part of String\(e\.timeLabel\)\.split\(\/(\\b(?:AM|PM)\\b)\/i\)\) \{)',
    r'// Remove spaces around em dash to reduce visual gap\n      const cleanTimeLabel = String(e.timeLabel).replace(/\s+--\s+/g, "--");\n      for (const part of cleanTimeLabel.split(/(\\b(?:AM|PM)\\b)/i)) {',
    content,
    flags=re.MULTILINE
)

# 4. Add CSS at the end of the <style> block, just before the closing </style>
# Find the position of the last '</style>' and insert before it.
if '</style>' in content:
    insert_pos = content.rindex('</style>')
    css_to_insert = '''
/* Price right-aligned on desktop */
@media (min-width:900px) {
  .price {
    margin-left: auto;
  }
}

/* Category chips gap */
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

/* Chip and tag corner radius */
.chip, .tag {
  border-radius: 2px;
}
'''
    content = content[:insert_pos] + css_to_insert + '\n' + content[insert_pos:]
else:
    # fallback: append to end of head? but we assume </style> exists
    pass

with open('/var/www/pinkpages.indigokarasu.com/index.html', 'w') as f:
    f.write(content)
print('Patched successfully')