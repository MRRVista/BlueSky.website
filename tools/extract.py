"""Convert the 5100 Main workbook into report JSON for bluesky.website.
Usage: python3 tools/extract.py <workbook.xlsx> <out.json>
The JSON is uploaded to the private Blob store (data/report.json) — never committed."""
import sys, json, re, datetime, math
import openpyxl
from openpyxl.utils import get_column_letter

SRC, OUT = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(SRC, data_only=True)

def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def rgb(color):
    try:
        v = color.rgb
        return v if isinstance(v, str) else None
    except Exception:
        return None

def fmt_num(v, f):
    neg = v < 0
    a = abs(v)
    if '%' in f:
        dec = len(f.split('.')[1].split('%')[0]) if '.' in f else 0
        s = f"{a*100:,.{dec}f}%"
    elif re.search(r'0\.00', f) and '#,##0' in f or f == '#,##0.00':
        s = f"{a:,.2f}"
    elif '#,##0' in f:
        s = f"{a:,.0f}"
    elif f == '0.00':
        s = f"{a:,.2f}"
    else:  # General
        if abs(a - round(a)) < 1e-9:
            s = f"{int(round(a))}" if 1900 <= a <= 2100 else f"{int(round(a)):,}"
        elif a < 10:
            s = f"{a:,.2f}"
        else:
            s = f"{a:,.0f}"
    if neg:
        paren = '(' in f and ('#,##0' in f) and '%' not in f
        return (f"({s})" if paren else f"−{s}"), True
    return s, False

def kind_of(cell):
    fill = rgb(cell.fill.fgColor) if cell.fill and cell.fill.fill_type else None
    if fill in ('FF1F4E79',): return 'sec'
    if fill in ('FF7B2C2C',): return 'warn'
    if fill in ('FFDDEBF7',): return 'input'
    if fill in ('FFFFFF00', 'FFFFC000'): return 'hl'
    if fill in ('FF92D050',): return 'good'
    if fill in ('FFFCE4D6',): return 'note'
    return None

sheets = []
for ws in wb.worksheets:
    if ws.sheet_state != 'visible':
        continue
    grid = []
    used_cols = set()
    for row in ws.iter_rows():
        cells = []
        for c in row:
            v = c.value
            if v is None or (isinstance(v, str) and not v.strip()):
                continue
            neg = False
            num = isinstance(v, (int, float)) and not isinstance(v, bool)
            if isinstance(v, (datetime.datetime, datetime.date)):
                text = f"{v.month}/{v.day}/{v.year}"
            elif num:
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    continue
                text, neg = fmt_num(v, c.number_format or 'General')
            else:
                text = str(v).strip()
            cell = {"c": c.column, "t": text}
            if num: cell["n"] = 1
            if neg: cell["neg"] = 1
            if c.font and c.font.bold: cell["b"] = 1
            k = kind_of(c)
            if k: cell["k"] = k
            cells.append(cell)
            used_cols.add(c.column)
        grid.append(cells)
    # trim trailing empty rows
    while grid and not grid[-1]: grid.pop()
    while grid and not grid[0]: grid.pop(0)
    if not used_cols:
        continue
    first, last = min(used_cols), max(used_cols)
    widths = []
    for col in range(first, last + 1):
        d = ws.column_dimensions.get(get_column_letter(col))
        widths.append(round(d.width, 1) if d and d.width else 9)
    rows = []
    for cells in grid:
        for cell in cells:
            cell["c"] -= first
        rows.append(cells)
    sheets.append({"name": ws.title, "slug": slug(ws.title), "cols": last - first + 1, "widths": widths, "rows": rows})

json.dump({"source": SRC.split('/')[-1], "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(), "sheets": sheets},
          open(OUT, 'w'), separators=(',', ':'))
print(f"{len(sheets)} sheets ->", OUT)
for s in sheets: print(f"  {s['name']}: {len(s['rows'])} rows x {s['cols']} cols")
