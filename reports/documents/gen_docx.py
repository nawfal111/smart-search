"""
Convert smart_search_technical_report.md → smart_search_technical_report.docx
"""
import re
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

MD_PATH   = "smart_search_technical_report.md"
DOCX_PATH = "smart_search_technical_report.docx"

# ── colour palette ────────────────────────────────────────────────────────────
H1_COLOR  = RGBColor(0x1F, 0x49, 0x7D)   # dark navy
H2_COLOR  = RGBColor(0x2E, 0x74, 0xB5)   # blue
H3_COLOR  = RGBColor(0x20, 0x60, 0x9F)   # lighter blue
CODE_BG   = RGBColor(0xF2, 0xF2, 0xF2)   # light grey

# ── helpers ───────────────────────────────────────────────────────────────────

def set_cell_bg(cell, color: RGBColor):
    """Set table cell background colour."""
    shd = OxmlElement("w:shd")
    hex_color = f"{color[0]:02X}{color[1]:02X}{color[2]:02X}"
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    cell._tc.get_or_add_tcPr().append(shd)


def set_run_bg(run, color: RGBColor):
    """Set character highlight (shading) for inline code runs."""
    rpr = run._r.get_or_add_rPr()
    shd = OxmlElement("w:shd")
    hex_color = f"{color[0]:02X}{color[1]:02X}{color[2]:02X}"
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    rpr.append(shd)


def apply_inline(para, text: str, base_size: int = 11):
    """
    Parse inline markdown (bold, italic, code) and add runs to *para*.
    Handles: **bold**, *italic*, `code`, and plain text.
    """
    # Combined pattern: **bold**, *italic*, `code`
    pattern = r'(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`)'
    parts   = re.split(pattern, text)
    i = 0
    while i < len(parts):
        chunk = parts[i]
        if not chunk:
            i += 1
            continue
        if chunk.startswith('**') and chunk.endswith('**'):
            run = para.add_run(chunk[2:-2])
            run.bold = True
            run.font.size = Pt(base_size)
        elif chunk.startswith('*') and chunk.endswith('*') and not chunk.startswith('**'):
            run = para.add_run(chunk[1:-1])
            run.italic = True
            run.font.size = Pt(base_size)
        elif chunk.startswith('`') and chunk.endswith('`'):
            run = para.add_run(chunk[1:-1])
            run.font.name = "Courier New"
            run.font.size = Pt(base_size - 1)
            set_run_bg(run, CODE_BG)
        else:
            # Plain text — may still have sub-patterns not caught by split
            sub = re.split(r'(\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`)', chunk)
            for s in sub:
                if not s:
                    continue
                if re.match(r'\*\*(.+?)\*\*', s):
                    run = para.add_run(s[2:-2])
                    run.bold = True
                elif re.match(r'\*(.+?)\*', s):
                    run = para.add_run(s[1:-1])
                    run.italic = True
                elif re.match(r'`([^`]+?)`', s):
                    run = para.add_run(s[1:-1])
                    run.font.name = "Courier New"
                    run.font.size = Pt(base_size - 1)
                    set_run_bg(run, CODE_BG)
                else:
                    run = para.add_run(s)
                run.font.size = Pt(base_size)
        i += 1


def add_code_block(doc: Document, code_text: str):
    """Add a grey-background monospaced code block paragraph."""
    para = doc.add_paragraph()
    para.paragraph_format.left_indent  = Inches(0.3)
    para.paragraph_format.right_indent = Inches(0.3)
    para.paragraph_format.space_before = Pt(4)
    para.paragraph_format.space_after  = Pt(4)
    # grey background on entire paragraph
    pPr = para._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), "F2F2F2")
    pPr.append(shd)

    run = para.add_run(code_text)
    run.font.name = "Courier New"
    run.font.size = Pt(9)
    return para


def add_table_from_md(doc: Document, table_lines: list):
    """Render a markdown table (pipe-delimited) into a Word table."""
    rows = [l for l in table_lines if not re.match(r'^\s*\|[-| :]+\|\s*$', l)]
    if not rows:
        return

    # Parse cells
    parsed = []
    for row in rows:
        cells = [c.strip() for c in row.strip().strip('|').split('|')]
        parsed.append(cells)

    cols = max(len(r) for r in parsed)
    tbl  = doc.add_table(rows=len(parsed), cols=cols)
    tbl.style = "Table Grid"

    for ri, row in enumerate(parsed):
        for ci, cell_text in enumerate(row):
            cell = tbl.cell(ri, ci)
            cell.text = ""
            para = cell.paragraphs[0]
            apply_inline(para, cell_text, base_size=10)
            if ri == 0:                       # header row
                for run in para.runs:
                    run.bold = True
                set_cell_bg(cell, RGBColor(0xD6, 0xE4, 0xF0))


# ── main conversion ───────────────────────────────────────────────────────────

def convert(md_path: str, docx_path: str):
    with open(md_path, encoding="utf-8") as f:
        lines = f.readlines()

    doc  = Document()
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)

    # Wider margins
    for section in doc.sections:
        section.top_margin    = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin   = Inches(1.25)
        section.right_margin  = Inches(1.25)

    i          = 0
    in_code    = False
    code_lines = []
    table_lines = []
    in_table   = False

    while i < len(lines):
        raw  = lines[i].rstrip('\n')
        line = raw.strip()

        # ── code fence ────────────────────────────────────────────────────
        if line.startswith('```'):
            if not in_code:
                in_code    = True
                code_lines = []
            else:
                add_code_block(doc, '\n'.join(code_lines))
                in_code = False
            i += 1
            continue

        if in_code:
            code_lines.append(raw)
            i += 1
            continue

        # ── table detection ───────────────────────────────────────────────
        if line.startswith('|'):
            table_lines.append(line)
            i += 1
            # keep consuming table rows
            while i < len(lines) and lines[i].strip().startswith('|'):
                table_lines.append(lines[i].strip())
                i += 1
            add_table_from_md(doc, table_lines)
            table_lines = []
            doc.add_paragraph()   # spacing after table
            continue

        # ── horizontal rule ───────────────────────────────────────────────
        if re.match(r'^---+$', line):
            doc.add_paragraph()
            i += 1
            continue

        # ── headings ──────────────────────────────────────────────────────
        m = re.match(r'^(#{1,4})\s+(.*)', line)
        if m:
            level = len(m.group(1))
            text  = m.group(2)
            if level == 1:
                para = doc.add_heading(text, level=0)
                para.runs[0].font.color.rgb = H1_COLOR
                para.runs[0].font.size = Pt(18)
            elif level == 2:
                para = doc.add_heading(text, level=1)
                para.runs[0].font.color.rgb = H2_COLOR
                para.runs[0].font.size = Pt(14)
            elif level == 3:
                para = doc.add_heading(text, level=2)
                para.runs[0].font.color.rgb = H3_COLOR
                para.runs[0].font.size = Pt(12)
            else:
                para = doc.add_heading(text, level=3)
                para.runs[0].font.size = Pt(11)
            i += 1
            continue

        # ── bold header line (e.g. **Author:** Nawfal) ────────────────────
        if re.match(r'^\*\*.+\*\*', line) and not line.startswith('- '):
            para = doc.add_paragraph()
            apply_inline(para, line)
            i += 1
            continue

        # ── unordered list ────────────────────────────────────────────────
        if re.match(r'^[-*]\s+', line):
            para = doc.add_paragraph(style="List Bullet")
            apply_inline(para, line[2:].strip())
            i += 1
            continue

        # ── ordered list ──────────────────────────────────────────────────
        if re.match(r'^\d+\.\s+', line):
            para = doc.add_paragraph(style="List Number")
            apply_inline(para, re.sub(r'^\d+\.\s+', '', line))
            i += 1
            continue

        # ── blank line ────────────────────────────────────────────────────
        if line == '':
            i += 1
            continue

        # ── regular paragraph ─────────────────────────────────────────────
        para = doc.add_paragraph()
        apply_inline(para, line)
        i += 1

    doc.save(docx_path)
    print(f"Saved: {docx_path}")


if __name__ == "__main__":
    import os
    base = os.path.dirname(os.path.abspath(__file__))
    convert(
        os.path.join(base, MD_PATH),
        os.path.join(base, DOCX_PATH),
    )
