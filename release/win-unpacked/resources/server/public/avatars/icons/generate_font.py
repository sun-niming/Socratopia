#!/usr/bin/env python3
"""
Socratopia Blocks font — faithful reproduction of the logo.
ALL letters 4 cols × 7 rows. Supports full blocks, triangles, and centered stems.

Cell values:
  0    = empty
  1    = full square block
  'c'  = centered block (x offset to sit between col 1 and col 2)
  'tl' = ◤ top-left triangle
  'tr' = ◥ top-right triangle
  'bl' = ◣ bottom-left triangle
  'br' = ◢ bottom-right triangle
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
import os

_ = 0

GLYPHS = {
    # S: fold = ◣ corner at bar end + full block extension; ◥ corner at other bar end + full block
    'S': [
        ['br', 1,    1,   'bl' ],   # ◢##◣  bar + corner turns into fold
        [ 1,   _,    _,    1   ],   # #__#  left col + fold (full block)
        [ 1,   _,    _,    _   ],   # #___
        ['tr', 1,    1,   'bl' ],   # ◥##◣  middle transition
        [ _,   _,    _,    1   ],   # ___#
        [ 1,   _,    _,    1   ],   # #__#  fold (full block) + right col
        ['tr', 1,    1,   'tl' ],   # ◥##◤  corner turns into fold + bar
    ],
    # O: rounded all 4 corners
    'O': [
        ['br', 1,    1,   'bl' ],   # ◢##◣
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
        ['tr', 1,    1,   'tl' ],   # ◥##◤
    ],
    # C: fold = ◣ corner at bar end + full block extension (symmetric top/bottom)
    'C': [
        ['br', 1,    1,   'bl' ],   # ◢##◣  bar + corner turns into fold
        [ 1,   _,    _,    1   ],   # #__#  left col + fold (full block)
        [ 1,   _,    _,    _   ],   # #___
        [ 1,   _,    _,    _   ],   # #___
        [ 1,   _,    _,    _   ],   # #___
        [ 1,   _,    _,    1   ],   # #__#  left col + fold (full block)
        ['tr', 1,    1,   'tl' ],   # ◥##◤  corner turns into fold + bar
    ],
    # R: rounded bowl, leg = full blocks stepping col1→col2→col3, all ◣ corners
    'R': [
        [ 1,   1,    1,   'bl' ],   # ###◣
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   1,    1,   'bl' ],   # ###◣  bowl close + leg start
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
    ],
    # A: rounded top corners
    'A': [
        ['br', 1,    1,   'bl' ],   # ◢##◣
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   1,    1,    1   ],   # ####
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
    ],
    # T: full top bar, centered 1-wide stem (offset between col 1 and col 2)
    'T': [
        [ 1,   1,    1,    1   ],   # ####
        ['c',  _,    _,    _   ],   # centered stem
        ['c',  _,    _,    _   ],
        ['c',  _,    _,    _   ],
        ['c',  _,    _,    _   ],
        ['c',  _,    _,    _   ],
        ['c',  _,    _,    _   ],
    ],
    # P: rounded TR/BR on bowl, plain left column below
    'P': [
        [ 1,   1,    1,   'bl' ],   # ###◣
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   _,    _,    1   ],   # #__#
        [ 1,   1,    1,   'tl' ],   # ###◤
        [ 1,   _,    _,    _   ],   # #___
        [ 1,   _,    _,    _   ],   # #___
        [ 1,   _,    _,    _   ],   # #___
    ],
    # I: full top/bottom bars, centered 1-wide stem
    'I': [
        [ 1,   1,    1,    1   ],   # ####
        ['c',  _,    _,    _   ],   # centered stem
        ['c',  _,    _,    _   ],
        ['c',  _,    _,    _   ],
        ['c',  _,    _,    _   ],
        ['c',  _,    _,    _   ],
        [ 1,   1,    1,    1   ],   # ####
    ],
}

# ─── Font metrics ───
UNITS_PER_EM = 1000
ASCENT = 800
DESCENT = -200

BLOCK_SIZE = 130
GAP = 14
CELL_SIZE = BLOCK_SIZE + GAP
SIDE_BEARING = 40
NUM_COLS = 4

# Pre-calculate centered stem x position (between col 1 and col 2)
_content_width = NUM_COLS * CELL_SIZE - GAP
CENTER_X = SIDE_BEARING + (_content_width - BLOCK_SIZE) / 2


def cell_to_polygon(r, c, cell_type):
    """Return polygon vertices for a cell, or None if empty."""
    if cell_type == 0:
        return None

    y = ASCENT - (r + 1) * CELL_SIZE + GAP

    # Centered stem block (offset x)
    if cell_type == 'c':
        x = CENTER_X
        return [(x, y), (x + BLOCK_SIZE, y), (x + BLOCK_SIZE, y + BLOCK_SIZE), (x, y + BLOCK_SIZE)]

    # Normal grid position
    x = SIDE_BEARING + c * CELL_SIZE

    bl = (x, y)
    br = (x + BLOCK_SIZE, y)
    tr = (x + BLOCK_SIZE, y + BLOCK_SIZE)
    tl = (x, y + BLOCK_SIZE)

    if cell_type == 1:
        return [bl, br, tr, tl]
    elif cell_type == 'tl':
        return [tl, bl, tr]          # ◤
    elif cell_type == 'tr':
        return [tl, br, tr]          # ◥
    elif cell_type == 'bl':
        return [bl, br, tl]          # ◣
    elif cell_type == 'br':
        return [bl, br, tr]          # ◢
    return None


def build_font(output_path):
    advance_width = SIDE_BEARING * 2 + NUM_COLS * CELL_SIZE - GAP

    glyph_names = ['.notdef', 'space'] + list(GLYPHS.keys())
    fb = FontBuilder(UNITS_PER_EM, isTTF=True)
    fb.setupGlyphOrder(glyph_names)

    cmap = {0x20: 'space'}
    for letter in GLYPHS:
        cmap[ord(letter)] = letter
    fb.setupCharacterMap(cmap)

    glyphs = {}
    metrics = {}

    # .notdef
    pen = TTGlyphPen(None)
    pen.moveTo((100, 0)); pen.lineTo((500, 0)); pen.lineTo((500, 700)); pen.lineTo((100, 700)); pen.closePath()
    pen.moveTo((150, 50)); pen.lineTo((150, 650)); pen.lineTo((450, 650)); pen.lineTo((450, 50)); pen.closePath()
    glyphs['.notdef'] = pen.glyph()
    metrics['.notdef'] = (600, 100)

    # space
    pen = TTGlyphPen(None)
    glyphs['space'] = pen.glyph()
    metrics['space'] = (advance_width, 0)

    # Letters
    for letter, grid in GLYPHS.items():
        pen = TTGlyphPen(None)
        for r, row in enumerate(grid):
            for c, val in enumerate(row):
                poly = cell_to_polygon(r, c, val)
                if poly:
                    pen.moveTo(poly[0])
                    for pt in poly[1:]:
                        pen.lineTo(pt)
                    pen.closePath()
        glyphs[letter] = pen.glyph()
        metrics[letter] = (advance_width, SIDE_BEARING)

    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)

    fb.setupNameTable({
        "familyName": "Socratopia Blocks",
        "styleName": "Regular",
        "psName": "SocratopiaBlocks-Regular",
        "manufacturer": "SocraLab",
        "designer": "SocraLab",
        "description": "Pixel block font — faithful copy of the Socratopia logo",
        "vendorURL": "https://socratopia.app",
        "version": "Version 4.0",
    })

    fb.setupOS2(
        sTypoAscender=ASCENT,
        sTypoDescender=DESCENT,
        sTypoLineGap=0,
        usWinAscent=ASCENT,
        usWinDescent=abs(DESCENT),
        sxHeight=500,
        sCapHeight=ASCENT - 20,
    )

    fb.setupPost()
    fb.font.save(output_path)
    print(f"Font saved to: {output_path}")


if __name__ == '__main__':
    output = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'SocratopiaBlocks-Regular.ttf')
    build_font(output)
