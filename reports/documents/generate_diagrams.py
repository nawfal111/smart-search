#!/usr/bin/env python3
"""
Smart Search — Thesis Diagram Generator
Run: python3 generate_diagrams.py
Produces 3 PNG files in the same folder as this script.
"""

import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch

OUT = os.path.dirname(os.path.abspath(__file__))

# ── Colour palette ─────────────────────────────────────────────────────────────
BLUE    = '#1D4ED8'; LBLUE  = '#EFF6FF'; MBLU  = '#BFDBFE'
GREEN   = '#15803D'; LGREEN = '#F0FDF4'; MGRN  = '#86EFAC'
AMBER   = '#92400E'; LAMBER = '#FFFBEB'; MAMB  = '#FDE68A'
PURPLE  = '#5B21B6'; LPURP  = '#F5F3FF'; MPUR  = '#C4B5FD'
SLATE   = '#1E293B'; LSLATE = '#F8FAFC'; MSLT  = '#CBD5E1'
RED     = '#B91C1C'; LRED   = '#FEF2F2'
WHITE   = '#FFFFFF'


# ── Drawing helpers ────────────────────────────────────────────────────────────

def rbox(ax, cx, cy, w, h, text, bg, border,
         fs=9, bold=False, tc='#1E293B', lw=1.8):
    """Rounded rectangle with centred text."""
    p = FancyBboxPatch(
        (cx - w / 2, cy - h / 2), w, h,
        boxstyle='round,pad=0.003,rounding_size=0.018',
        facecolor=bg, edgecolor=border, linewidth=lw, zorder=3
    )
    ax.add_patch(p)
    ax.text(cx, cy, text, ha='center', va='center',
            fontsize=fs, fontweight='bold' if bold else 'normal',
            color=tc, zorder=4, multialignment='center', linespacing=1.35)


def pill(ax, cx, cy, w, h, text, bg, border, fs=9, bold=True, tc='#1E293B'):
    """Stadium/pill shape (very rounded rectangle)."""
    p = FancyBboxPatch(
        (cx - w / 2, cy - h / 2), w, h,
        boxstyle=f'round,pad=0.003,rounding_size={h/2}',
        facecolor=bg, edgecolor=border, linewidth=2, zorder=3
    )
    ax.add_patch(p)
    ax.text(cx, cy, text, ha='center', va='center',
            fontsize=fs, fontweight='bold' if bold else 'normal',
            color=tc, zorder=4, multialignment='center')


def diamond(ax, cx, cy, w, h, text, bg, border, fs=8.5):
    """Decision diamond."""
    pts = [(cx, cy + h / 2), (cx + w / 2, cy),
           (cx, cy - h / 2), (cx - w / 2, cy)]
    d = mpatches.Polygon(pts, closed=True,
                         facecolor=bg, edgecolor=border,
                         linewidth=1.8, zorder=3)
    ax.add_patch(d)
    ax.text(cx, cy, text, ha='center', va='center',
            fontsize=fs, fontweight='bold', color='#1E293B',
            zorder=4, multialignment='center', linespacing=1.2)


def arr(ax, x1, y1, x2, y2, label='', lc='#94A3B8', fs=7.5, bold_lbl=False):
    """Straight arrow from (x1,y1) to (x2,y2)."""
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle='->', lw=1.6, color=lc,
                                mutation_scale=12), zorder=2)
    if label:
        mx = (x1 + x2) / 2
        my = (y1 + y2) / 2
        dx = 0.014 if x1 == x2 else 0
        ax.text(mx + dx, my, label, fontsize=fs, color=lc, style='italic',
                va='center', ha='left' if x1 == x2 else 'center',
                fontweight='bold' if bold_lbl else 'normal')


def harr(ax, x1, y1, x2, y2, label='', lc='#94A3B8', fs=7.5):
    """L-shaped arrow: right then down (or left then up)."""
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(
                    arrowstyle='->', lw=1.6, color=lc, mutation_scale=12,
                    connectionstyle='angle,angleA=0,angleB=90,rad=0.08'
                ), zorder=2)
    if label:
        ax.text((x1 + x2) / 2, y1 + 0.012, label, fontsize=fs, color=lc,
                style='italic', va='bottom', ha='center')


def side_exit(ax, cx, cy, direction, label, lc, fs=7.5):
    """Short horizontal exit arrow from a diamond, with label."""
    dx = 0.55 if direction == 'right' else -0.55
    ax.annotate('', xy=(cx + dx, cy), xytext=(cx + dx * 0.45, cy),
                arrowprops=dict(arrowstyle='->', lw=1.5, color=lc,
                                mutation_scale=11), zorder=2)
    ha = 'left' if direction == 'right' else 'right'
    ax.text(cx + dx + (0.02 if direction == 'right' else -0.02), cy,
            label, fontsize=fs, color=lc, va='center', ha=ha, style='italic')


# ═══════════════════════════════════════════════════════════════════════════════
# DIAGRAM 1 — System Architecture
# ═══════════════════════════════════════════════════════════════════════════════

def make_architecture():
    fig, ax = plt.subplots(figsize=(20, 11))
    fig.patch.set_facecolor(LSLATE)
    ax.set_facecolor(LSLATE)
    ax.set_xlim(0, 20)
    ax.set_ylim(0, 11)
    ax.axis('off')

    ax.text(10, 10.65, 'Smart Search — System Architecture',
            ha='center', va='center', fontsize=16,
            fontweight='bold', color=SLATE)

    # ── Swim-lane backgrounds ────────────────────────────────────────────────
    for lx, lw, bg, border, title in [
        (0.25,  6.3,  MBLU, BLUE,   'VS Code Extension\n(TypeScript / Node.js)'),
        (6.75,  6.3,  MGRN, GREEN,  'Python Backend\n(localhost:8000)'),
        (13.25, 6.3,  MAMB, AMBER,  'Cloud Services'),
    ]:
        bg_patch = FancyBboxPatch(
            (lx, 0.3), lw, 9.8,
            boxstyle='round,pad=0.05,rounding_size=0.2',
            facecolor=bg, edgecolor=border,
            linewidth=2.2, alpha=0.22, zorder=0
        )
        ax.add_patch(bg_patch)
        ax.text(lx + lw / 2, 9.9, title,
                ha='center', va='center', fontsize=11.5,
                fontweight='bold', color=border)

    # ── Extension column  (cx ≈ 3.4) ────────────────────────────────────────
    EX = 3.4
    W1 = 5.7
    H  = 0.72
    rbox(ax, EX, 8.7,  W1, H,
         'File Watcher\nonDidSave · onDidDelete · onDidRename',
         WHITE, BLUE, fs=9)
    rbox(ax, EX, 7.6,  W1, H,
         'Code Chunker  (TypeScript, local, no network)\n12 languages  ·  brace / indent / end-keyword',
         WHITE, BLUE, fs=9)
    rbox(ax, EX, 6.5,  W1, H,
         'Hash Store  —  .smart-search/index.json\nFile MD5 + Function MD5 (normalised)',
         WHITE, BLUE, fs=9)
    rbox(ax, EX, 5.3,  W1, H,
         'Two-Phase Batch Indexer\nPhase 1: scan all files  ·  Phase 2: send batches of 50',
         WHITE, BLUE, fs=9)
    rbox(ax, EX, 4.1,  W1, H,
         'User Identity\ngit config --global user.email  →  MD5 hash = userId',
         WHITE, BLUE, fs=9)
    rbox(ax, EX, 2.9,  W1, H,
         'Search UI  (Webview Panel)\nHTML + CSS + JS  ·  message-passing to extension host',
         WHITE, BLUE, fs=9)
    rbox(ax, EX, 1.7,  W1, H,
         'Status Bar\nscanning N/M  ·  embedding N/M  ·  N files updated',
         WHITE, BLUE, fs=9)

    # ── Backend column  (cx ≈ 9.9) ──────────────────────────────────────────
    BK = 9.9
    W2 = 5.9
    rbox(ax, BK, 8.7,  W2, H,
         'ThreadingHTTPServer  (Python stdlib)\nOne thread per request — /index and /search run in parallel',
         WHITE, GREEN, fs=9)
    rbox(ax, BK, 7.6,  W2, H,
         'GPT Summarizer  [index time]\n50 GPT-4o-mini calls fired in parallel via ThreadPoolExecutor',
         WHITE, GREEN, fs=9)
    rbox(ax, BK, 6.5,  W2, H,
         'Voyage AI Embedder\n[Function label + GPT summary + code]  →  1,536-float vector',
         WHITE, GREEN, fs=9)
    rbox(ax, BK, 5.3,  W2, H,
         'Pinecone Client\nupsert / delete / query  ·  namespace: {projectId}::{userId}',
         WHITE, GREEN, fs=9)
    rbox(ax, BK, 4.1,  W2, H,
         'Line Locator  [search time]\nGPT-4o-mini pinpoints exact line per result — parallel',
         WHITE, GREEN, fs=9)
    rbox(ax, BK, 2.9,  W2, H,
         'Normal Search  (Python re)\nregex / text / whole-word scan across workspace files',
         WHITE, GREEN, fs=9)
    rbox(ax, BK, 1.7,  W2, H,
         '/config  ·  /health  ·  /done\nMin query length  ·  health check  ·  index summary',
         WHITE, GREEN, fs=9)

    # ── Cloud column  (cx ≈ 16.4) ────────────────────────────────────────────
    CL = 16.4
    W3 = 5.7
    rbox(ax, CL, 7.8,  W3, 1.1,
         'OpenAI  GPT-4o-mini\nSummarises functions at index time\nPinpoints relevant line at search time',
         WHITE, AMBER, fs=9.5, bold=True)
    rbox(ax, CL, 5.8,  W3, 1.1,
         'Voyage AI  voyage-code-2\n1,536-dim code-specific vectors\ninput_type = document | query',
         WHITE, AMBER, fs=9.5, bold=True)
    rbox(ax, CL, 3.5,  W3, 1.5,
         'Pinecone  (HNSW)\nManaged vector database\ncosine similarity · namespace isolation\ntop-k approximate nearest-neighbour',
         LPURP, PURPLE, fs=9.5, bold=True, tc=PURPLE)

    # ── Arrows: Extension → Backend ──────────────────────────────────────────
    arr(ax, 6.25, 5.3,  7.0, 5.3,   'POST /index  (50 chunks)', lc=BLUE,  fs=8)
    arr(ax, 6.25, 2.9,  7.0, 2.9,   'POST /search',              lc=BLUE,  fs=8)
    arr(ax, 6.25, 1.7,  7.0, 1.7,   'GET /config  ·  POST /done', lc=BLUE, fs=8)
    arr(ax, 7.0,  2.65, 6.25, 2.65, 'results JSON',              lc=GREEN, fs=8)

    # ── Arrows: Backend → Cloud ───────────────────────────────────────────────
    arr(ax, 12.85, 7.5,  13.5, 7.8,  'summarize()',    lc=AMBER,  fs=8)
    arr(ax, 12.85, 4.1,  13.5, 7.4,  'locate_line()',  lc=AMBER,  fs=8)
    arr(ax, 12.85, 6.5,  13.5, 5.8,  'embed()',        lc=AMBER,  fs=8)
    arr(ax, 12.85, 5.3,  13.5, 3.5,  'upsert / query', lc=PURPLE, fs=8)

    fig.savefig(os.path.join(OUT, 'architecture.png'),
                dpi=180, bbox_inches='tight')
    plt.close(fig)
    print('architecture.png  saved')


# ═══════════════════════════════════════════════════════════════════════════════
# DIAGRAM 2 — Indexing Pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def make_indexing():
    fig, ax = plt.subplots(figsize=(11, 22))
    fig.patch.set_facecolor(LSLATE)
    ax.set_facecolor(LSLATE)
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 22)
    ax.axis('off')

    ax.text(5.5, 21.5, 'Smart Search — Indexing Pipeline',
            ha='center', va='center', fontsize=15,
            fontweight='bold', color=SLATE)

    CX = 5.5   # centre x for main flow
    BW = 6.0   # box width
    BH = 0.72  # box height
    DW = 3.4   # diamond width
    DH = 0.75  # diamond height

    # ── Phase labels on left ─────────────────────────────────────────────────
    def phase(y, text, color):
        ax.text(0.35, y, text, fontsize=7.8, color=color,
                va='center', ha='center', fontweight='bold',
                rotation=90, style='italic')

    phase(19.3, 'TRIGGER',  SLATE)
    phase(17.3, 'SCAN',     BLUE)
    phase(14.5, 'DIFF',     BLUE)
    phase(11.2, 'BATCH',    GREEN)
    phase(7.8,  'AI',       AMBER)
    phase(4.5,  'STORE',    PURPLE)
    phase(1.8,  'DONE',     GREEN)

    # Step 1 — Start
    pill(ax, CX, 20.8, 4.0, 0.55,
         'File Saved  /  Workspace Opened',
         MGRN, GREEN, fs=10, tc=SLATE)

    arr(ax, CX, 20.52, CX, 20.0)

    # Step 2 — Compute file hash
    rbox(ax, CX, 19.65, BW, BH,
         'Compute MD5 hash of entire file',
         LBLUE, BLUE, fs=9.5)

    arr(ax, CX, 19.28, CX, 18.7)

    # Step 3 — File hash changed?
    diamond(ax, CX, 18.25, DW, DH,
            'File hash\nchanged?', LBLUE, BLUE, fs=9)

    # No exit → right
    ax.plot([CX + DW/2, 9.5, 9.5], [18.25, 18.25, 19.65],
            color=MSLT, lw=1.5, zorder=2)
    rbox(ax, 9.5, 20.1, 2.2, 0.55,
         'Skip file\n(already indexed)', LSLATE, MSLT, fs=8, tc='#64748B')
    ax.text(CX + DW/2 + 0.1, 18.35, 'No', fontsize=8,
            color='#64748B', style='italic')

    # Yes → down
    arr(ax, CX, 17.87, CX, 17.3)
    ax.text(CX + 0.12, 17.6, 'Yes', fontsize=8,
            color=BLUE, style='italic')

    # Step 4 — Chunk file
    rbox(ax, CX, 16.95, BW, BH,
         'Chunk file into functions  (TypeScript, local)\nbrace / indent / end-keyword detection',
         LBLUE, BLUE, fs=9.5)

    arr(ax, CX, 16.59, CX, 16.05)

    # Step 5 — Normalised function hash
    rbox(ax, CX, 15.70, BW, BH,
         'Compute normalised function hash\n(strip trailing whitespace + blank lines)',
         LBLUE, BLUE, fs=9.5)

    arr(ax, CX, 15.34, CX, 14.75)

    # Step 6 — Function changed?
    diamond(ax, CX, 14.30, DW, DH,
            'Function\nnew or changed?', LBLUE, BLUE, fs=9)

    # No exit → right
    ax.plot([CX + DW/2, 9.0, 9.0], [14.30, 14.30, 15.7],
            color=MSLT, lw=1.5, zorder=2)
    rbox(ax, 9.0, 16.15, 2.2, 0.55,
         'Skip function\n(vector unchanged)', LSLATE, MSLT, fs=8, tc='#64748B')
    ax.text(CX + DW/2 + 0.1, 14.4, 'No', fontsize=8,
            color='#64748B', style='italic')

    # Yes → down
    arr(ax, CX, 13.92, CX, 13.35)
    ax.text(CX + 0.12, 13.65, 'Yes', fontsize=8,
            color=BLUE, style='italic')

    # Step 7 — Add to batch
    rbox(ax, CX, 13.0, BW, BH,
         'Add to embed queue\n(filter out class-level chunks)',
         LBLUE, BLUE, fs=9.5)

    arr(ax, CX, 12.64, CX, 12.1)

    # Step 8 — Batch full / all files scanned?
    diamond(ax, CX, 11.62, DW + 0.4, DH,
            'Batch of 50 ready\nor all files scanned?', MGRN, GREEN, fs=9)

    # No → loop left back to next file
    ax.plot([CX - (DW+0.4)/2, 1.2, 1.2], [11.62, 11.62, 19.65],
            color=MSLT, lw=1.5, zorder=2)
    ax.annotate('', xy=(CX, 20.52),
                xytext=(1.2, 20.52),  # won't draw to pill, just to illustrate
                arrowprops=dict(arrowstyle='->', lw=1.4, color=MSLT,
                                mutation_scale=10), zorder=2)
    ax.text(1.2 - 0.12, 15.6, 'No — next file', fontsize=7.8,
            color='#64748B', style='italic', ha='right', rotation=90)

    # Yes → down
    arr(ax, CX, 11.24, CX, 10.65)
    ax.text(CX + 0.12, 10.97, 'Yes', fontsize=8,
            color=GREEN, style='italic')

    # Step 9 — GPT summaries
    rbox(ax, CX, 10.3, BW, BH,
         'GPT-4o-mini: generate plain-English summary per function\n(all 50 fired in parallel — total time ≈ 1 GPT call)',
         LAMBER, AMBER, fs=9.5)

    arr(ax, CX, 9.94, CX, 9.4)

    # Step 10 — Voyage AI embed
    rbox(ax, CX, 9.05, BW, BH,
         'Voyage AI  voyage-code-2\n[Name + Summary + Code]  →  1,536-float vector (one API call)',
         LAMBER, AMBER, fs=9.5)

    arr(ax, CX, 8.69, CX, 8.15)

    # Step 11 — Pinecone upsert
    rbox(ax, CX, 7.80, BW, BH,
         'Pinecone  HNSW\nupsert 50 vectors + metadata  [namespace: projectId::userId]',
         LPURP, PURPLE, fs=9.5)

    arr(ax, CX, 7.44, CX, 6.9)

    # Step 12 — Save index.json
    rbox(ax, CX, 6.55, BW, BH,
         'Save index.json immediately  (crash-safe checkpoint)\nif interrupted, next run resumes from this batch',
         LGREEN, GREEN, fs=9.5)

    arr(ax, CX, 6.19, CX, 5.65)

    # Step 13 — More batches?
    diamond(ax, CX, 5.17, DW, DH,
            'More batches\nremaining?', MGRN, GREEN, fs=9)

    # Yes → loop left to batch
    ax.plot([CX - DW/2, 1.5, 1.5], [5.17, 5.17, 13.0],
            color=MSLT, lw=1.5, zorder=2)
    ax.annotate('', xy=(CX - BW/2, 13.0), xytext=(1.5, 13.0),
                arrowprops=dict(arrowstyle='->', lw=1.4, color=MSLT,
                                mutation_scale=10), zorder=2)
    ax.text(1.5 - 0.12, 9.1, 'Yes — next batch', fontsize=7.8,
            color='#64748B', style='italic', ha='right', rotation=90)

    # No → down
    arr(ax, CX, 4.79, CX, 4.25)
    ax.text(CX + 0.12, 4.55, 'No', fontsize=8,
            color=GREEN, style='italic')

    # Step 14 — POST /done
    rbox(ax, CX, 3.90, BW, BH,
         'POST /done  →  backend prints terminal summary\nembedded N functions  ·  deleted N  ·  N files changed',
         LGREEN, GREEN, fs=9.5)

    arr(ax, CX, 3.54, CX, 3.05)

    # End
    pill(ax, CX, 2.75, 3.2, 0.5,
         'Indexing Complete', MGRN, GREEN, fs=10, tc=SLATE)

    # ── Phase bracket lines on left ──────────────────────────────────────────
    for y1, y2, color in [
        (21.1, 20.5, SLATE),
        (20.5, 17.1, BLUE),
        (17.1, 12.4, BLUE),
        (12.4, 9.65, GREEN),
        (9.65, 7.1, AMBER),
        (7.1,  5.9, PURPLE),
        (5.9,  2.5, GREEN),
    ]:
        ax.plot([0.55, 0.55], [y1, y2], color=color, lw=3, solid_capstyle='round',
                alpha=0.45, zorder=1)

    fig.savefig(os.path.join(OUT, 'indexing_pipeline.png'),
                dpi=180, bbox_inches='tight')
    plt.close(fig)
    print('indexing_pipeline.png  saved')


# ═══════════════════════════════════════════════════════════════════════════════
# DIAGRAM 3 — AI Search Pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def make_search():
    fig, ax = plt.subplots(figsize=(11, 18))
    fig.patch.set_facecolor(LSLATE)
    ax.set_facecolor(LSLATE)
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 18)
    ax.axis('off')

    ax.text(5.5, 17.55, 'Smart Search — AI Search Pipeline',
            ha='center', va='center', fontsize=15,
            fontweight='bold', color=SLATE)

    CX = 5.5
    BW = 6.2
    BH = 0.72
    DW = 3.6
    DH = 0.75

    def phase(y, text, color):
        ax.text(0.35, y, text, fontsize=7.8, color=color,
                va='center', ha='center', fontweight='bold',
                rotation=90, style='italic')

    phase(16.4, 'INPUT',    SLATE)
    phase(14.9, 'VALIDATE', BLUE)
    phase(12.6, 'EMBED',    AMBER)
    phase(10.5, 'RETRIEVE', PURPLE)
    phase(8.0,  'FILTER',   GREEN)
    phase(5.8,  'LOCATE',   AMBER)
    phase(2.5,  'OUTPUT',   GREEN)

    # ── Start ────────────────────────────────────────────────────────────────
    pill(ax, CX, 17.05, 4.8, 0.55,
         'User types query in AI Search mode',
         MBLU, BLUE, fs=10, tc=SLATE)

    arr(ax, CX, 16.77, CX, 16.2)

    # ── Validate length ──────────────────────────────────────────────────────
    diamond(ax, CX, 15.75, DW, DH,
            'Query length\n≥ minAiQueryLength\n(default 5)?', LBLUE, BLUE, fs=8.5)

    # No → right → error
    ax.plot([CX + DW/2, 9.6], [15.75, 15.75], color=RED, lw=1.5, zorder=2)
    rbox(ax, 9.65, 15.75, 1.8, 0.65,
         'Show error\nmessage', LRED, RED, fs=8.5, tc=RED)
    ax.text(CX + DW/2 + 0.1, 15.85, 'No', fontsize=8,
            color=RED, style='italic')

    # Yes → down
    arr(ax, CX, 15.37, CX, 14.8)
    ax.text(CX + 0.12, 15.1, 'Yes', fontsize=8, color=BLUE, style='italic')

    # ── Forward to backend ───────────────────────────────────────────────────
    rbox(ax, CX, 14.45, BW, BH,
         'Extension forwards query  →  POST /search\n(query, namespace, threshold, file filters)',
         LBLUE, BLUE, fs=9.5)

    arr(ax, CX, 14.09, CX, 13.55)

    # ── Backend validates ────────────────────────────────────────────────────
    rbox(ax, CX, 13.20, BW, BH,
         'Backend validates length again  (safety net)\nRejects if query < MIN_AI_QUERY_LENGTH',
         LBLUE, BLUE, fs=9.5)

    arr(ax, CX, 12.84, CX, 12.3)

    # ── Embed query ──────────────────────────────────────────────────────────
    rbox(ax, CX, 11.95, BW, BH,
         'Voyage AI  voyage-code-2\nEmbed query using  input_type="query"  →  1,536-float vector',
         LAMBER, AMBER, fs=9.5)

    arr(ax, CX, 11.59, CX, 11.05)

    # ── Pinecone HNSW ────────────────────────────────────────────────────────
    rbox(ax, CX, 10.70, BW, BH,
         'Pinecone HNSW  —  top-10 nearest vectors\ncosine similarity search in namespace  [projectId::userId]',
         LPURP, PURPLE, fs=9.5)

    arr(ax, CX, 10.34, CX, 9.8)

    # ── Filter threshold ─────────────────────────────────────────────────────
    diamond(ax, CX, 9.32, DW + 0.2, DH,
            'Score ≥ threshold\n(default 35%)?', MGRN, GREEN, fs=9)

    # No → drop
    ax.plot([CX + (DW+0.2)/2, 9.7], [9.32, 9.32], color=MSLT, lw=1.5, zorder=2)
    rbox(ax, 9.72, 9.32, 1.8, 0.6,
         'Drop result\n(low relevance)', LSLATE, MSLT, fs=8, tc='#64748B')
    ax.text(CX + (DW+0.2)/2 + 0.1, 9.42, 'No', fontsize=8,
            color='#64748B', style='italic')

    # Yes → down
    arr(ax, CX, 8.94, CX, 8.4)
    ax.text(CX + 0.12, 8.7, 'Yes', fontsize=8, color=GREEN, style='italic')

    # ── Apply file filters ───────────────────────────────────────────────────
    rbox(ax, CX, 8.05, BW, BH,
         'Apply include / exclude glob filters\ne.g.  filesInclude=*.php   filesExclude=test*',
         LGREEN, GREEN, fs=9.5)

    arr(ax, CX, 7.69, CX, 7.15)

    # ── Sort by score ────────────────────────────────────────────────────────
    rbox(ax, CX, 6.80, BW, BH,
         'Sort results by score  (highest first)\nreturn metadata: file, name, lines, summary, content',
         LGREEN, GREEN, fs=9.5)

    arr(ax, CX, 6.44, CX, 5.9)

    # ── Line locator ─────────────────────────────────────────────────────────
    rbox(ax, CX, 5.55, BW, BH,
         'GPT-4o-mini  —  Line Locator\nAll results fire in parallel  →  reply: { line, content }',
         LAMBER, AMBER, fs=9.5)

    arr(ax, CX, 5.19, CX, 4.65)

    # ── Return results ───────────────────────────────────────────────────────
    rbox(ax, CX, 4.30, BW, BH,
         'Return results JSON to extension\n{ score, file, name, start_line, summary, match_line, match_content }',
         LPURP, PURPLE, fs=9)

    arr(ax, CX, 3.94, CX, 3.4)

    # ── Render UI ────────────────────────────────────────────────────────────
    rbox(ax, CX, 3.05, BW, BH,
         'Webview renders result cards\nscore  ·  function name  ·  GPT summary  ·  → matched line',
         LBLUE, BLUE, fs=9.5)

    arr(ax, CX, 2.69, CX, 2.15)

    # ── End ──────────────────────────────────────────────────────────────────
    pill(ax, CX, 1.85, 4.4, 0.52,
         'User clicks → File opens at exact line',
         MGRN, GREEN, fs=10, tc=SLATE)

    # ── Phase bracket lines ───────────────────────────────────────────────────
    for y1, y2, color in [
        (17.35, 16.5,  SLATE),
        (16.5,  15.1,  BLUE),
        (15.1,  12.1,  BLUE),
        (12.1,  11.3,  AMBER),
        (11.3,  9.7,   PURPLE),
        (9.7,   7.45,  GREEN),
        (7.45,  4.95,  AMBER),
        (4.95,  1.6,   GREEN),
    ]:
        ax.plot([0.55, 0.55], [y1, y2], color=color, lw=3,
                solid_capstyle='round', alpha=0.45, zorder=1)

    fig.savefig(os.path.join(OUT, 'search_pipeline.png'),
                dpi=180, bbox_inches='tight')
    plt.close(fig)
    print('search_pipeline.png  saved')


# ── Run all ────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    make_architecture()
    make_indexing()
    make_search()
    print('\nDone. Check the reports/documents/ folder.')
