from __future__ import annotations

import html
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PDF_DEPS = ROOT / ".codex_tmp" / "pdf_deps"
if PDF_DEPS.exists():
    sys.path.insert(0, str(PDF_DEPS))

try:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        Flowable,
        KeepTogether,
        ListFlowable,
        ListItem,
        PageBreak,
        Paragraph,
        Preformatted,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )
except ImportError as exc:
    raise SystemExit(
            "Dependencias ausentes. Instalando ReportLab em .codex_tmp\\pdf_deps..."
        )
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--target", str(PDF_DEPS), "reportlab"])
    sys.path.insert(0, str(PDF_DEPS))
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        Flowable,
        KeepTogether,
        ListFlowable,
        ListItem,
        PageBreak,
        Paragraph,
        Preformatted,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )


SOURCE = ROOT / "docs" / "manual-integracao-sertao-replay.md"
OUTPUT = ROOT / "docs" / "manual-integracao-sertao-replay.pdf"


class ArchitectureFlow(Flowable):
    def __init__(self, width: float, height: float = 2.6 * cm) -> None:
        super().__init__()
        self.width = width
        self.height = height

    def draw(self) -> None:
        c = self.canv
        labels = ["Camera RTSP", "Servidor local", "capture-server", "Backend Render", "Frontend Vercel"]
        box_w = self.width / 5 - 0.22 * cm
        box_h = 1.25 * cm
        y = 0.65 * cm
        palette = [
            colors.HexColor("#EAF4F4"),
            colors.HexColor("#F4F1DE"),
            colors.HexColor("#E8F0FE"),
            colors.HexColor("#FDEBD3"),
            colors.HexColor("#EAF7EA"),
        ]
        for index, label in enumerate(labels):
            x = index * (box_w + 0.22 * cm)
            c.setFillColor(palette[index])
            c.setStrokeColor(colors.HexColor("#39515E"))
            c.roundRect(x, y, box_w, box_h, 7, stroke=1, fill=1)
            c.setFillColor(colors.HexColor("#1E2A32"))
            c.setFont("Helvetica-Bold", 8.5)
            c.drawCentredString(x + box_w / 2, y + box_h / 2 - 3, label)
            if index < len(labels) - 1:
                ax = x + box_w
                ay = y + box_h / 2
                c.setStrokeColor(colors.HexColor("#39515E"))
                c.line(ax + 0.04 * cm, ay, ax + 0.18 * cm, ay)
                c.line(ax + 0.18 * cm, ay, ax + 0.1 * cm, ay + 0.07 * cm)
                c.line(ax + 0.18 * cm, ay, ax + 0.1 * cm, ay - 0.07 * cm)


class HorizontalRule(Flowable):
    def __init__(self, width: float, color=colors.HexColor("#D6DEE3")) -> None:
        super().__init__()
        self.width = width
        self.height = 0.2 * cm
        self.color = color

    def draw(self) -> None:
        self.canv.setStrokeColor(self.color)
        self.canv.line(0, self.height / 2, self.width, self.height / 2)


def clean_inline(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<font face='Courier'>\1</font>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"\*([^*]+)\*", r"<i>\1</i>", text)
    return text


def read_markdown() -> list[str]:
    return SOURCE.read_text(encoding="utf-8").splitlines()


def extract_title_and_meta(lines: list[str]) -> tuple[str, list[str], list[str]]:
    title = "Manual de Integracao do Sertao Replay"
    meta: list[str] = []
    start = 0

    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip()
        start = 1

    for index in range(start, min(start + 6, len(lines))):
        line = lines[index].strip()
        if not line:
            continue
        if line.startswith("## "):
            break
        meta.append(line)

    content_start = start
    while content_start < len(lines):
        if lines[content_start].startswith("## "):
            break
        content_start += 1

    return title, meta, lines[content_start:]


def section_index(lines: list[str]) -> list[str]:
    return [line[3:].strip() for line in lines if line.startswith("## ")]


def build_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="CoverTitle",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=26,
            leading=31,
            textColor=colors.HexColor("#1E2A32"),
            alignment=TA_LEFT,
            spaceAfter=14,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CoverSubtitle",
            parent=styles["Normal"],
            fontSize=11.5,
            leading=16,
            textColor=colors.HexColor("#455A64"),
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="H1Manual",
            parent=styles["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=17,
            leading=22,
            textColor=colors.HexColor("#1E4E5F"),
            spaceBefore=14,
            spaceAfter=8,
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="H2Manual",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12.5,
            leading=16,
            textColor=colors.HexColor("#2B5B45"),
            spaceBefore=10,
            spaceAfter=5,
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyManual",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.6,
            leading=13.5,
            textColor=colors.HexColor("#263238"),
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BulletManual",
            parent=styles["BodyManual"],
            leftIndent=13,
            firstLineIndent=0,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CodeManual",
            parent=styles["Code"],
            fontName="Courier",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#14212B"),
            backColor=colors.HexColor("#F3F6F8"),
            borderColor=colors.HexColor("#D6DEE3"),
            borderWidth=0.4,
            borderPadding=6,
            spaceBefore=4,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="TOCManual",
            parent=styles["BodyManual"],
            fontSize=9.2,
            leading=12.2,
            leftIndent=10,
            spaceAfter=3,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SmallCenter",
            parent=styles["BodyManual"],
            fontSize=8,
            leading=10,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#607D8B"),
        )
    )
    return styles


def flush_paragraph(buffer: list[str], story: list, styles) -> None:
    if not buffer:
        return
    text = " ".join(item.strip() for item in buffer if item.strip())
    if text:
        story.append(Paragraph(clean_inline(text), styles["BodyManual"]))
    buffer.clear()


def flush_list(buffer: list[tuple[str, str]], story: list, styles) -> None:
    if not buffer:
        return

    for marker, text in buffer:
        if marker.startswith("number:"):
            bullet_text = f"{marker.split(':', 1)[1]}."
            body = text
        elif marker == "check":
            bullet_text = "[ ]"
            body = text
        elif marker == "checked":
            bullet_text = "[x]"
            body = text
        else:
            bullet_text = "-"
            body = text
        story.append(Paragraph(clean_inline(body), styles["BulletManual"], bulletText=bullet_text))

    story.append(Spacer(1, 2))
    buffer.clear()


def maybe_table_from_code(code: str, styles):
    lines = [line.strip() for line in code.splitlines() if line.strip()]
    if len(lines) < 3 or not all(line.startswith("|") and line.endswith("|") for line in lines[:3]):
        return None
    if not re.match(r"^\|[-:| ]+\|$", lines[1]):
        return None

    rows = []
    for line in [lines[0]] + lines[2:]:
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        rows.append([Paragraph(clean_inline(cell), styles["BodyManual"]) for cell in cells])

    col_count = len(rows[0])
    width = 17.2 * cm
    table = Table(rows, colWidths=[width / col_count] * col_count, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E4E5F")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#C9D3D8")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#FAFBFC")),
            ]
        )
    )
    return table


def parse_content(lines: list[str], styles, usable_width: float) -> list:
    story: list = []
    paragraph_buffer: list[str] = []
    list_buffer: list[tuple[str, str]] = []
    code_buffer: list[str] = []
    in_code = False
    first_section = True

    for raw in lines:
        line = raw.rstrip()

        if line.startswith("```"):
            if in_code:
                code = "\n".join(code_buffer)
                table = maybe_table_from_code(code, styles)
                if table is not None:
                    story.append(table)
                    story.append(Spacer(1, 7))
                else:
                    story.append(Preformatted(code, styles["CodeManual"], maxLineLength=96))
                code_buffer.clear()
                in_code = False
            else:
                flush_paragraph(paragraph_buffer, story, styles)
                flush_list(list_buffer, story, styles)
                in_code = True
            continue

        if in_code:
            code_buffer.append(line)
            continue

        if not line.strip():
            flush_paragraph(paragraph_buffer, story, styles)
            flush_list(list_buffer, story, styles)
            continue

        if line.startswith("## "):
            flush_paragraph(paragraph_buffer, story, styles)
            flush_list(list_buffer, story, styles)
            heading = line[3:].strip()
            if heading in {"Seguranca"}:
                story.append(PageBreak())
            if not first_section:
                story.append(Spacer(1, 2))
            first_section = False
            story.append(Paragraph(clean_inline(heading), styles["H1Manual"]))
            story.append(HorizontalRule(usable_width))
            continue

        if line.startswith("### "):
            flush_paragraph(paragraph_buffer, story, styles)
            flush_list(list_buffer, story, styles)
            story.append(Paragraph(clean_inline(line[4:].strip()), styles["H2Manual"]))
            continue

        stripped = line.lstrip()
        numbered = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        bullet = re.match(r"^-\s+(.*)$", stripped)
        checkbox = re.match(r"^-\s+\[( |x|X)\]\s+(.*)$", stripped)
        if numbered:
            flush_paragraph(paragraph_buffer, story, styles)
            list_buffer.append((f"number:{numbered.group(1)}", numbered.group(2)))
            continue
        if checkbox:
            flush_paragraph(paragraph_buffer, story, styles)
            marker = "check" if checkbox.group(1) == " " else "checked"
            list_buffer.append((marker, checkbox.group(2)))
            continue
        if bullet:
            flush_paragraph(paragraph_buffer, story, styles)
            list_buffer.append(("bullet", bullet.group(1)))
            continue

        flush_list(list_buffer, story, styles)
        paragraph_buffer.append(line)

    flush_paragraph(paragraph_buffer, story, styles)
    flush_list(list_buffer, story, styles)
    return story


def cover_story(title: str, meta: list[str], sections: list[str], styles, usable_width: float) -> list:
    story: list = []
    story.append(Spacer(1, 1.2 * cm))
    story.append(Paragraph(clean_inline(title), styles["CoverTitle"]))
    story.append(
        Paragraph(
            "Guia passo a passo para adicionar cameras, configurar o servidor local, iniciar o capture-server e operar replays.",
            styles["CoverSubtitle"],
        )
    )
    story.append(Spacer(1, 0.35 * cm))
    for item in meta:
        story.append(Paragraph(clean_inline(item), styles["CoverSubtitle"]))
    story.append(Spacer(1, 0.7 * cm))
    story.append(ArchitectureFlow(usable_width))
    story.append(Spacer(1, 0.7 * cm))
    story.append(Paragraph("Indice rapido", styles["H1Manual"]))
    toc_rows = []
    for index, section in enumerate(sections[:18], start=1):
        toc_rows.append([Paragraph(str(index), styles["SmallCenter"]), Paragraph(clean_inline(section), styles["TOCManual"])])
    toc = Table(toc_rows, colWidths=[0.8 * cm, usable_width - 0.8 * cm], hAlign="LEFT")
    toc.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#1E4E5F")),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    story.append(toc)
    story.append(PageBreak())
    return story


def draw_page_frame(canvas, doc) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setStrokeColor(colors.HexColor("#D6DEE3"))
    canvas.setLineWidth(0.5)
    canvas.line(doc.leftMargin, height - 1.35 * cm, width - doc.rightMargin, height - 1.35 * cm)
    canvas.line(doc.leftMargin, 1.2 * cm, width - doc.rightMargin, 1.2 * cm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#607D8B"))
    canvas.drawString(doc.leftMargin, 0.75 * cm, "Sertao Replay - Manual de Integracao")
    canvas.drawRightString(width - doc.rightMargin, 0.75 * cm, f"Pagina {doc.page}")
    canvas.restoreState()


def main() -> None:
    lines = read_markdown()
    title, meta, content_lines = extract_title_and_meta(lines)
    styles = build_styles()

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=1.8 * cm,
        leftMargin=1.8 * cm,
        topMargin=1.75 * cm,
        bottomMargin=1.55 * cm,
        title=title,
        author="Sertao Replay",
        subject="Manual de integracao e operacao",
    )
    usable_width = A4[0] - doc.leftMargin - doc.rightMargin
    story = cover_story(title, meta, section_index(content_lines), styles, usable_width)
    story.extend(parse_content(content_lines, styles, usable_width))
    doc.build(story, onFirstPage=draw_page_frame, onLaterPages=draw_page_frame)
    print(OUTPUT)


if __name__ == "__main__":
    main()
