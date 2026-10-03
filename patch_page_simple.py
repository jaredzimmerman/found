# Simple patch for the three fixes

with open('/var/www/pinkpages.indigokarasu.com/index.html', 'r') as f:
    lines = f.readlines()

# We'll process line by line and make changes in a new list.
new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # 1. Look for the priceSlot creation block and skip it (we'll re-add it later in meta)
    if line.strip() == '// The price sits in the time column, left-aligned under the start time.' and i+10 < len(lines):
        # Skip the next 10 lines (approximately) that constitute the priceSlot creation
        # We'll just skip until we see a line that is not part of that block.
        # Instead, let's just skip until we see a line that is not indented as part of the block.
        # But for simplicity, we'll skip a fixed number of lines? Better to detect the block.
        # Let's just skip until we see a line that starts with '      if (meta.childNodes.length)' or similar.
        # Actually, we can just remove the block and later add the price appending in meta.
        # We'll skip until we see a line that is not part of the priceSlot creation.
        # The block ends before the comment 'if (meta.childNodes.length) body.append(meta);'
        # So we'll skip until we see that line, but we need to keep that line.
        # Let's just skip until we see a line that contains 'if (meta.childNodes.length)'.
        j = i
        while j < len(lines) and 'if (meta.childNodes.length)' not in lines[j]:
            j += 1
        # Now j is at the line with 'if (meta.childNodes.length)'
        # We want to skip from i to j-1, and then we will process line j normally.
        # But we also want to insert the price appending into meta after the address block.
        # We'll handle that separately by modifying the meta block.
        # For now, just skip the priceSlot creation block.
        i = j
        continue  # skip to the line with 'if (meta.childNodes.length)'
    
    # 2. Look for the time.append(t, priceSlot) line and change to time.append(t)
    if 'time.append(t, priceSlot);' in line:
        new_lines.append(line.replace('time.append(t, priceSlot);', '      time.append(t);'))
        i += 1
        continue
    
    # 3. Look for the timeLabel split line and insert the cleaning step before it.
    if 'for (const part of String(e.timeLabel).split(/(\\b(?:AM|PM)\\b)/i)) {' in line:
        # Insert the cleaning line before this line.
        new_lines.append('      // Remove spaces around em dash to reduce visual gap\n')
        new_lines.append('      const cleanTimeLabel = String(e.timeLabel).replace(/\\s+--\\s+/g, "--");\n')
        new_lines.append('      for (const part of cleanTimeLabel.split(/(\\b(?:AM|PM)\\b)/i)) {\n')
        i += 1
        continue
    
    # 4. We also need to modify the meta block to append the price if present.
    # We'll do that by looking for the address block and after appending address, we append price.
    # But we already skipped the priceSlot creation, so we need to add the price appending in meta.
    # Let's look for the line: '        meta.append(ad);' and after that, we want to insert the price appending.
    if 'meta.append(ad);' in line:
        new_lines.append(line)
        i += 1
        # Now insert the price appending after this line, but we need to be careful about indentation.
        # The current line is exactly '        meta.append(ad);'
        # We want to insert after it, at the same indentation level.
        # We'll insert the price appending lines.
        new_lines.append('        // Price is a fact about the ticket, not a category.\n')
        new_lines.append('        if (e.priceLabel) {\n')
        new_lines.append('          const pl = document.createElement("span");\n')
        new_lines.append('          pl.className = "price" + (e.priceTier === "free" ? " free" : "");\n')
        new_lines.append('          pl.textContent = e.priceLabel;\n')
        new_lines.append('          meta.append(pl);\n')
        new_lines.append('        }\n')
        continue
    
    # 5. If we reach the end of the style block, we can insert our CSS before the closing </style>
    # We'll do that after the loop by inserting into the string, but for simplicity, we'll just
    # append to the end of the head? Instead, we'll note the position and insert later.
    # Let's just collect the lines and then after the loop, we'll insert the CSS before </style>.
    new_lines.append(line)
    i += 1

# Now join the lines back into a string
content = ''.join(new_lines)

# Insert CSS before the closing </style>
if '</style>' in content:
    insert_pos = content.rindex('</style>')
    css = '''
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
    content = content[:insert_pos] + css + '\n' + content[insert_pos:]
else:
    # If no </style> found, append to the end of the head? but we assume it exists.
    pass

with open('/var/www/pinkpages.indigokarasu.com/index.html', 'w') as f:
    f.write(content)

print('Patched successfully')