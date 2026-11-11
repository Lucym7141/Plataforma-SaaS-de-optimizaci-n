import html
import io
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def _format_datetime(value: datetime) -> str:
    return value.isoformat(sep=" ", timespec="seconds")


def _problem_sections(execution):
    snapshot = execution.modelo_snapshot or {}
    values = {
        item.variable_nombre: item.valor
        for item in execution.valores.all()
    }
    objective_label = (
        "Maximizar"
        if snapshot.get("tipo_objetivo") == "MAX"
        else "Minimizar"
    )
    sections = [
        (
            "Resumen",
            ["Campo", "Valor"],
            [
                ["Modelo", snapshot.get("nombre", execution.problema.nombre)],
                ["Fecha", _format_datetime(execution.iniciada_en)],
                ["Estado", execution.get_estado_display()],
                ["Solucionador", execution.solucionador],
                ["Objetivo", objective_label],
                [
                    "Valor objetivo",
                    (
                        execution.valor_objetivo
                        if execution.valor_objetivo is not None
                        else "No disponible"
                    ),
                ],
                ["Mensaje", execution.mensaje or "Sin mensaje adicional."],
            ],
        ),
        (
            "Variables",
            ["Variable", "Tipo", "Límite inferior", "Límite superior", "Valor"],
            [
                [
                    item.get("nombre", ""),
                    item.get("tipo", ""),
                    item.get("limite_inferior"),
                    item.get("limite_superior"),
                    values.get(item.get("nombre")),
                ]
                for item in snapshot.get("variables", [])
            ],
        ),
        (
            "Función objetivo",
            ["Variable", "Coeficiente"],
            [
                [item.get("variable_nombre", ""), item.get("coeficiente", "")]
                for item in snapshot.get("terminos_objetivo", [])
            ],
        ),
        (
            "Restricciones",
            ["Restricción", "Variable", "Coeficiente", "Operador", "Lado derecho"],
            [
                [
                    constraint.get("nombre", ""),
                    term.get("variable_nombre", ""),
                    term.get("coeficiente", ""),
                    constraint.get("operador", ""),
                    constraint.get("lado_derecho", ""),
                ]
                for constraint in snapshot.get("restricciones", [])
                for term in constraint.get("terminos", [])
            ],
        ),
    ]
    return snapshot.get("nombre", execution.problema.nombre), sections


def _portfolio_sections(execution):
    snapshot = execution.modelo_snapshot or {}
    assets = snapshot.get("activos", [])
    returns = snapshot.get("rendimientos_esperados", [])
    categories = snapshot.get("categorias", [])
    contributions = execution.contribuciones_riesgo or []
    sections = [
        (
            "Resumen",
            ["Campo", "Valor"],
            [
                ["Portafolio", snapshot.get("nombre", execution.optimizacion.nombre)],
                ["Fecha", _format_datetime(execution.creada_en)],
                ["Estado", {"OPT": "Óptimo"}.get(
                    execution.estado,
                    execution.estado,
                )],
                ["Rendimiento esperado", execution.rendimientos_portafolio],
                ["Volatilidad", execution.volatilidad_portafolio],
                ["Rendimiento anualizado", execution.rendimiento_anualizado],
                ["Volatilidad anualizada", execution.volatilidad_anualizada],
                ["Utilidad ajustada por riesgo", execution.utilidad_riesgo],
            ],
        ),
        (
            "Asignación",
            [
                "Activo",
                "Categoría",
                "Rendimiento esperado",
                "Peso óptimo",
                "Contribución a volatilidad",
                "Proporción del riesgo",
            ],
            [
                [
                    asset,
                    categories[index] if index < len(categories) else "",
                    returns[index] if index < len(returns) else None,
                    execution.ponderaciones[index]
                    if index < len(execution.ponderaciones)
                    else None,
                    contributions[index].get("contribucion_volatilidad")
                    if index < len(contributions)
                    else None,
                    contributions[index].get("proporcion_volatilidad")
                    if index < len(contributions)
                    else None,
                ]
                for index, asset in enumerate(assets)
            ],
        ),
        (
            "Escenarios de estrés",
            ["Escenario", "Rendimiento simulado"],
            [
                [scenario, result]
                for scenario, result in (execution.resultados_estres or {}).items()
            ],
        ),
    ]
    return snapshot.get("nombre", execution.optimizacion.nombre), sections


def _safe_spreadsheet_text(value):
    if not isinstance(value, str):
        return value
    if value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")):
        return f"'{value}"
    return value


def build_excel_report(title, sections):
    workbook = Workbook()
    workbook.remove(workbook.active)
    for section_name, headers, rows in sections:
        worksheet = workbook.create_sheet(section_name[:31])
        worksheet.append([_safe_spreadsheet_text(title)])
        worksheet["A1"].font = Font(bold=True, size=14, color="FFFFFF")
        worksheet["A1"].fill = PatternFill("solid", fgColor="173B57")
        worksheet.append(headers)
        for cell in worksheet[2]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="246B73")
        for row in rows:
            worksheet.append([_safe_spreadsheet_text(value) for value in row])
        worksheet.freeze_panes = "A3"
        worksheet.auto_filter.ref = worksheet.dimensions
        for column in worksheet.columns:
            column_index = column[0].column
            width = max(
                (len(str(cell.value or "")) for cell in column),
                default=10,
            )
            worksheet.column_dimensions[
                get_column_letter(column_index)
            ].width = min(max(width + 2, 12), 48)
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def build_pdf_report(title, sections):
    output = io.BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=letter,
        rightMargin=0.55 * inch,
        leftMargin=0.55 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.55 * inch,
        title=title,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        textColor=colors.HexColor("#173b57"),
        alignment=TA_CENTER,
        spaceAfter=16,
    )
    body_style = ParagraphStyle(
        "ReportCell",
        parent=styles["BodyText"],
        fontSize=8,
        leading=10,
    )
    story = [Paragraph(html.escape(title), title_style)]
    for section_name, headers, rows in sections:
        story.append(Paragraph(html.escape(section_name), styles["Heading2"]))
        table_data = [
            [Paragraph(html.escape(str(header)), body_style) for header in headers]
        ]
        table_data.extend(
            [
                [
                    Paragraph(
                        html.escape("" if value is None else str(value)),
                        body_style,
                    )
                    for value in row
                ]
                for row in rows
            ]
        )
        table = Table(table_data, repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#246b73")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d6e0e5")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [
                colors.white,
                colors.HexColor("#f3f7f8"),
            ]),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.extend([table, Spacer(1, 12)])
    document.build(story)
    return output.getvalue()


def build_problem_report(execution, output_format):
    title, sections = _problem_sections(execution)
    if output_format == "pdf":
        return build_pdf_report(title, sections)
    return build_excel_report(title, sections)


def build_portfolio_report(execution, output_format):
    title, sections = _portfolio_sections(execution)
    if output_format == "pdf":
        return build_pdf_report(title, sections)
    return build_excel_report(title, sections)
