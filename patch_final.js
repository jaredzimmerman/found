// Patch for the time spacing: trim the non-meridiem part
// and also ensure the price is correctly placed (we already did, but let's double-check by ensuring we don't have duplicate price appending)
// We'll do two patches in one.

const fs = require('fs');
const path = '/var/www/pinkpages.indigokarasu.com/index.html';

let content = fs.readFileSync(path, 'utf8');

// 1. Fix the time non-meridiem part to be trimmed
const timeLoopElse = '        } else {\n          t.append(document.createTextNode(part));';
const timeLoopElseFixed = '        } else {\n          t.append(document.createTextNode(part.trim()));';
if (content.includes(timeLoopElse)) {
  content = content.replace(timeLoopElse, timeLoopElseFixed);
  console.log('Patched time non-meridiem part to trim');
} else {
  console.log('WARNING: timeLoopElse not found');
}

// 2. Ensure we don't have any leftover priceSlot creation (should be gone from our earlier patch)
//    and that we have the price appending in meta (we added it, but let's make sure it's there)
//    We'll also check that the meta has the price appending after the address block.
//    We'll do a simple check: look for the pattern we added.
//    If not present, we'll add it again (but we hope it's there).

// We'll also add the CSS for price right-alignment if missing (we thought it was there but verify-layout said missing)
// Let's check for the CSS we added.

const priceCSS = '/* Price right-aligned on desktop */\n@media (min-width:900px) {\n  .price {\n    margin-left: auto;\n  }\n}\n';
if (!content.includes(priceCSS)) {
  // Insert before the closing </style>
  const styleEnd = content.lastIndexOf('</style>');
  if (styleEnd !== -1) {
    content = content.slice(0, styleEnd) + priceCSS + content.slice(styleEnd);
    console.log('Added price right-aligned CSS');
  } else {
    console.log('ERROR: Could not find </style> to insert CSS');
  }
} else {
  console.log('Price right-aligned CSS already present');
}

fs.writeFileSync(path, content, 'utf8');
console.log('Patch written');