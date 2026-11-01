"""Convert HTML and LaTeX tables into GitHub-flavoured Markdown and a linearised text form.

GFM has no merged cells, so a cell spanning rows or columns is repeated in every position it
covers. That keeps each Markdown row self-contained, which is what retrieval needs. Tables
without explicit header rows use their first row as the GFM header.
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from html.parser import HTMLParser

MAXIMUM_ROW_SPAN = 500
MAXIMUM_COLUMN_SPAN = 100
HEADER_PART_SEPARATOR = " / "
LINEARISED_CELL_SEPARATOR = " | "
HTML_TABLE = re.compile(r"<table\b.*?</table>", re.IGNORECASE | re.DOTALL)

LATEX_TABULAR = re.compile(
    r"\\begin\{tabular\*?\}(?:\{[^{}]*\})?\{((?:[^{}]|\{[^{}]*\})*)\}(.*?)\\end\{tabular\*?\}", re.DOTALL
)
LATEX_RULE_COMMANDS = re.compile(
    r"\\(?:hline|toprule|midrule|bottomrule|cline\{[^}]*\}|cmidrule(?:\([^)]*\))?\{[^}]*\})"
)
LATEX_ROW_SEPARATOR = re.compile(r"(?<!\\)\\\\(?:\[[^\]]*\])?")
LATEX_CELL_SEPARATOR = re.compile(r"(?<!\\)&")
LATEX_MULTICOLUMN = re.compile(r"^\\multicolumn\{(\d+)\}\{[^}]*\}\{(.*)\}$", re.DOTALL)
LATEX_MULTIROW = re.compile(r"^\\multirow\{(-?\d+)\}\{[^}]*\}\{(.*)\}$", re.DOTALL)
LATEX_TEXT_STYLE = re.compile(r"\\(?:textbf|textit|emph|underline|text|mathrm|mbox)\{([^{}]*)\}")
LATEX_ESCAPED_CHARACTER = re.compile(r"\\([&%$#_{}])")


@dataclass(frozen=True, slots=True)
class TableCell:
    text: str
    row_span: int = 1
    column_span: int = 1
    is_header: bool = False


@dataclass(frozen=True, slots=True)
class Table:
    """A rectangular grid after span expansion; the first ``header_row_count`` rows are headers."""

    rows: tuple[tuple[str, ...], ...]
    header_row_count: int = 0

    @property
    def is_empty(self) -> bool:
        return not any(cell for row in self.rows for cell in row)


# ----------------------------------------------------------------------------- public API


def html_table_to_table(html: str) -> Table | None:
    """The first ``<table>`` in the HTML, or ``None`` when there is none."""
    parser = _HtmlTableParser()
    parser.feed(html)
    parser.close()
    if not parser.tables:
        return None
    return build_table(parser.tables[0])


def latex_tabular_to_table(latex: str) -> Table | None:
    """The first ``tabular`` environment, or ``None`` when there is none."""
    match = LATEX_TABULAR.search(latex)
    if match is None:
        return None
    return build_table(_parse_latex_rows(match.group(2)))


def build_table(cell_rows: Sequence[Sequence[TableCell]]) -> Table:
    expanded_rows = _expand_spans(cell_rows)
    return Table(rows=expanded_rows, header_row_count=_count_header_rows(cell_rows))


def table_to_markdown(table: Table) -> str:
    """GFM table; multiple header rows are merged column by column."""
    if not table.rows:
        return ""
    header_row_count = max(1, table.header_row_count)
    header = _merge_header_rows(table.rows[:header_row_count])
    lines = [_markdown_row(header), _markdown_row(["---"] * len(header))]
    lines.extend(_markdown_row(row) for row in table.rows[header_row_count:])
    return "\n".join(lines)


def linearise_table(table: Table) -> str:
    """``cell | cell`` per row, skipping empty rows: a plain-text fallback for search."""
    return "\n".join(LINEARISED_CELL_SEPARATOR.join(cell for cell in row) for row in table.rows if any(row))


def replace_html_tables_with_markdown(content: str) -> str:
    """Rewrite every HTML table inside Markdown content as a GFM table."""
    return _replace_html_tables(content, table_to_markdown)


def replace_html_tables_with_linearised_text(content: str) -> str:
    """Rewrite every HTML table inside Markdown content as ``cell | cell`` rows."""
    return _replace_html_tables(content, linearise_table)


def _replace_html_tables(content: str, render_table: Callable[[Table], str]) -> str:
    def convert(match: re.Match[str]) -> str:
        table = html_table_to_table(match.group(0))
        return render_table(table) if table is not None else match.group(0)

    return HTML_TABLE.sub(convert, content)


# ----------------------------------------------------------------------------- span expansion


def _expand_spans(cell_rows: Sequence[Sequence[TableCell]]) -> tuple[tuple[str, ...], ...]:
    grid: dict[tuple[int, int], str] = {}
    for row_index, cells in enumerate(cell_rows):
        column_index = 0
        for cell in cells:
            while (row_index, column_index) in grid:
                column_index += 1
            _place_cell(grid, cell, row_index, column_index)
            column_index += _bounded(cell.column_span, MAXIMUM_COLUMN_SPAN)
    if not grid:
        return ()
    row_count = max(row for row, _ in grid) + 1
    column_count = max(column for _, column in grid) + 1
    return tuple(
        tuple(grid.get((row, column), "") for column in range(column_count)) for row in range(row_count)
    )


def _place_cell(grid: dict[tuple[int, int], str], cell: TableCell, row_index: int, column_index: int) -> None:
    for row_offset in range(_bounded(cell.row_span, MAXIMUM_ROW_SPAN)):
        for column_offset in range(_bounded(cell.column_span, MAXIMUM_COLUMN_SPAN)):
            grid[(row_index + row_offset, column_index + column_offset)] = cell.text


def _count_header_rows(cell_rows: Sequence[Sequence[TableCell]]) -> int:
    header_row_count = 0
    for cells in cell_rows:
        if not cells or not all(cell.is_header for cell in cells):
            break
        header_row_count += 1
    return header_row_count


def _bounded(span: int, maximum: int) -> int:
    return min(max(1, span), maximum)


# ----------------------------------------------------------------------------- markdown rendering


def _merge_header_rows(header_rows: Sequence[Sequence[str]]) -> list[str]:
    merged_header: list[str] = []
    for column_parts in zip(*header_rows, strict=True):
        distinct_parts: list[str] = []
        for part in column_parts:
            if part and (not distinct_parts or distinct_parts[-1] != part):
                distinct_parts.append(part)
        merged_header.append(HEADER_PART_SEPARATOR.join(distinct_parts))
    return merged_header


def _markdown_row(cells: Sequence[str]) -> str:
    return "| " + " | ".join(_escape_markdown_cell(cell) for cell in cells) + " |"


def _escape_markdown_cell(cell: str) -> str:
    return cell.replace("|", "\\|").replace("\n", "<br>").strip()


# ----------------------------------------------------------------------------- HTML parsing


@dataclass
class _CellInProgress:
    row_span: int
    column_span: int
    is_header: bool
    text_parts: list[str] = field(default_factory=list)


class _HtmlTableParser(HTMLParser):
    """Collects the cells of top-level tables; nested tables contribute only their text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[TableCell]]] = []
        self._table_depth = 0
        self._is_in_header_section = False
        self._current_row: list[TableCell] | None = None
        self._current_cell: _CellInProgress | None = None

    def handle_starttag(self, tag: str, attributes: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._table_depth += 1
            if self._table_depth == 1:
                self.tables.append([])
        elif self._table_depth != 1:
            self._append_line_break_if(tag == "br")
        elif tag == "thead":
            self._is_in_header_section = True
        elif tag == "tr":
            self._current_row = []
        elif tag in ("td", "th"):
            self._start_cell(tag, dict(attributes))
        else:
            self._append_line_break_if(tag == "br")

    def handle_endtag(self, tag: str) -> None:
        if tag == "table":
            self._table_depth = max(0, self._table_depth - 1)
        elif self._table_depth != 1:
            return
        elif tag == "thead":
            self._is_in_header_section = False
        elif tag in ("td", "th"):
            self._finish_cell()
        elif tag == "tr":
            self._finish_row()

    def handle_data(self, data: str) -> None:
        if self._current_cell is not None:
            self._current_cell.text_parts.append(data)

    def close(self) -> None:
        super().close()
        self._finish_row()

    def _start_cell(self, tag: str, attributes: dict[str, str | None]) -> None:
        self._finish_cell()
        if self._current_row is None:
            self._current_row = []
        self._current_cell = _CellInProgress(
            row_span=_parse_span(attributes.get("rowspan")),
            column_span=_parse_span(attributes.get("colspan")),
            is_header=tag == "th" or self._is_in_header_section,
        )

    def _finish_cell(self) -> None:
        if self._current_cell is None or self._current_row is None:
            return
        raw_text = "".join(self._current_cell.text_parts)
        cell_text = "\n".join(" ".join(line.split()) for line in raw_text.split("\n")).strip()
        self._current_row.append(
            TableCell(
                text=cell_text,
                row_span=self._current_cell.row_span,
                column_span=self._current_cell.column_span,
                is_header=self._current_cell.is_header,
            )
        )
        self._current_cell = None

    def _finish_row(self) -> None:
        self._finish_cell()
        if self._current_row is not None and self.tables:
            self.tables[-1].append(self._current_row)
        self._current_row = None

    def _append_line_break_if(self, is_line_break: bool) -> None:
        if is_line_break and self._current_cell is not None:
            self._current_cell.text_parts.append("\n")


def _parse_span(raw_value: str | None) -> int:
    if raw_value is None or not raw_value.strip().isdigit():
        return 1
    return int(raw_value.strip())


# ----------------------------------------------------------------------------- LaTeX parsing


def _parse_latex_rows(tabular_body: str) -> list[list[TableCell]]:
    """Rows of cells; a ``\\multirow`` is filled down into the empty placeholders below it.

    Unlike HTML, LaTeX keeps an (empty) cell in every row a multirow covers, so spans are
    resolved here instead of by grid expansion.
    """
    without_rules = LATEX_RULE_COMMANDS.sub("", tabular_body)
    pending_fills: dict[int, _PendingFill] = {}
    rows: list[list[TableCell]] = []
    for raw_row in LATEX_ROW_SEPARATOR.split(without_rules):
        if raw_row.strip():
            cells = [_parse_latex_cell(raw_cell) for raw_cell in LATEX_CELL_SEPARATOR.split(raw_row)]
            rows.append(_fill_down_multirows(cells, pending_fills))
    return rows


@dataclass
class _PendingFill:
    text: str
    remaining_rows: int


def _fill_down_multirows(
    cells: Sequence[TableCell], pending_fills: dict[int, _PendingFill]
) -> list[TableCell]:
    resolved_cells: list[TableCell] = []
    column_index = 0
    for cell in cells:
        pending_fill = pending_fills.get(column_index)
        text = cell.text
        if pending_fill is not None and not text:
            text = pending_fill.text
        resolved_cells.append(TableCell(text=text, column_span=cell.column_span))
        if cell.row_span > 1:
            pending_fills[column_index] = _PendingFill(text=cell.text, remaining_rows=cell.row_span)
        column_index += cell.column_span
    _advance_pending_fills(pending_fills)
    return resolved_cells


def _advance_pending_fills(pending_fills: dict[int, _PendingFill]) -> None:
    for column_index in list(pending_fills):
        pending_fills[column_index].remaining_rows -= 1
        if pending_fills[column_index].remaining_rows <= 0:
            del pending_fills[column_index]


def _parse_latex_cell(raw_cell: str) -> TableCell:
    cell_source = raw_cell.strip()
    column_span = 1
    row_span = 1
    multicolumn = LATEX_MULTICOLUMN.match(cell_source)
    if multicolumn is not None:
        column_span = int(multicolumn.group(1))
        cell_source = multicolumn.group(2).strip()
    multirow = LATEX_MULTIROW.match(cell_source)
    if multirow is not None:
        row_span = abs(int(multirow.group(1)))
        cell_source = multirow.group(2).strip()
    return TableCell(text=_latex_cell_text(cell_source), row_span=row_span, column_span=column_span)


def _latex_cell_text(cell_source: str) -> str:
    text = cell_source
    previous_text = None
    while previous_text != text:
        previous_text = text
        text = LATEX_TEXT_STYLE.sub(r"\1", text)
    text = LATEX_ESCAPED_CHARACTER.sub(r"\1", text)
    return " ".join(text.split())
