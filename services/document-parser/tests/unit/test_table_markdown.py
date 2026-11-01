from app.domain.table_markdown import (
    Table,
    html_table_to_table,
    latex_tabular_to_table,
    linearise_table,
    replace_html_tables_with_linearised_text,
    replace_html_tables_with_markdown,
    table_to_markdown,
)

PRICING_HTML = (
    "<table><thead><tr><th>Plan</th><th>Monthly price</th></tr></thead>"
    "<tbody><tr><td>Starter</td><td>$19</td></tr><tr><td>Business</td><td>$49</td></tr></tbody></table>"
)


def html_to_markdown(html: str) -> str:
    table = html_table_to_table(html)
    assert table is not None
    return table_to_markdown(table)


def test_html_table_with_header_becomes_gfm() -> None:
    assert html_to_markdown(PRICING_HTML) == (
        "| Plan | Monthly price |\n| --- | --- |\n| Starter | $19 |\n| Business | $49 |"
    )


def test_linearised_table_matches_contract_example() -> None:
    table = html_table_to_table(PRICING_HTML)
    assert table is not None

    assert linearise_table(table) == "Plan | Monthly price\nStarter | $19\nBusiness | $49"


def test_colspan_is_repeated_across_covered_columns() -> None:
    html = "<table><tr><td>A</td><td>B</td><td>C</td></tr><tr><td colspan='2'>x</td><td>3</td></tr></table>"

    assert html_to_markdown(html).splitlines()[-1] == "| x | x | 3 |"


def test_rowspan_is_repeated_down_covered_rows() -> None:
    html = (
        "<table><tr><th>Region</th><th>Q</th><th>Sales</th></tr>"
        "<tr><td rowspan='2'>North</td><td>Q1</td><td>10</td></tr>"
        "<tr><td>Q2</td><td>12</td></tr></table>"
    )

    assert html_to_markdown(html).splitlines()[2:] == ["| North | Q1 | 10 |", "| North | Q2 | 12 |"]


def test_empty_and_missing_cells_are_padded() -> None:
    html = "<table><tr><td>A</td><td></td><td>C</td></tr><tr><td>only</td></tr></table>"

    assert html_to_markdown(html) == "| A |  | C |\n| --- | --- | --- |\n| only |  |  |"


def test_multiple_header_rows_are_merged() -> None:
    html = (
        "<table><thead><tr><th colspan='2'>Price</th></tr><tr><th>Monthly</th><th>Yearly</th></tr></thead>"
        "<tr><td>19</td><td>190</td></tr></table>"
    )

    assert html_to_markdown(html).splitlines()[0] == "| Price / Monthly | Price / Yearly |"


def test_pipes_and_line_breaks_are_escaped() -> None:
    html = "<table><tr><th>a|b</th></tr><tr><td>line one<br/>line two</td></tr></table>"

    assert html_to_markdown(html) == "| a\\|b |\n| --- |\n| line one<br>line two |"


def test_huge_spans_are_bounded() -> None:
    table = html_table_to_table("<table><tr><td colspan='100000' rowspan='99999'>x</td></tr></table>")
    assert table is not None

    assert len(table.rows) == 500
    assert len(table.rows[0]) == 100


def test_nested_tables_contribute_text_only() -> None:
    table = html_table_to_table(
        "<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>"
    )

    assert table == Table(rows=(("outerinner",),), header_row_count=0)


def test_text_without_table_gives_none() -> None:
    assert html_table_to_table("<p>no table</p>") is None
    assert latex_tabular_to_table("no tabular") is None


def test_empty_table_renders_nothing() -> None:
    assert table_to_markdown(Table(rows=())) == ""


def test_latex_tabular_with_multicolumn_and_rules() -> None:
    latex = (
        r"\begin{tabular}{lcc}\toprule \textbf{Plan} & Price & Seats \\ \midrule "
        r"Starter & \$19 & 1 \\ \multicolumn{2}{c}{Enterprise 50\%} & 100 \\ \bottomrule\end{tabular}"
    )
    table = latex_tabular_to_table(latex)
    assert table is not None

    assert table_to_markdown(table) == (
        "| Plan | Price | Seats |\n| --- | --- | --- |\n| Starter | $19 | 1 |\n"
        "| Enterprise 50% | Enterprise 50% | 100 |"
    )


def test_latex_multirow_fills_the_placeholder_cells_below() -> None:
    latex = r"\begin{tabular}{ll}\multirow{2}{*}{North} & Q1 \\ & Q2 \\ South & Q1 \\\end{tabular}"
    table = latex_tabular_to_table(latex)
    assert table is not None

    assert table.rows == (("North", "Q1"), ("North", "Q2"), ("South", "Q1"))


def test_html_tables_inside_markdown_are_rewritten() -> None:
    content = "**Revenue**\n\n<table><tr><th>Year</th></tr><tr><td>2024</td></tr></table>"

    assert replace_html_tables_with_markdown(content) == "**Revenue**\n\n| Year |\n| --- |\n| 2024 |"
    assert replace_html_tables_with_linearised_text(content) == "**Revenue**\n\nYear\n2024"
