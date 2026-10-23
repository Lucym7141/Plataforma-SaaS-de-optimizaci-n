import csv
import io
from pathlib import Path

from django.conf import settings
from rest_framework import serializers

from .serializers import DatosPortafolioSerializer


def preview_portfolio_csv(uploaded_file, name):
    content = uploaded_file.read(settings.DATA_UPLOAD_MAX_MEMORY_SIZE + 1)
    if len(content) > settings.DATA_UPLOAD_MAX_MEMORY_SIZE:
        raise serializers.ValidationError({
            "archivo": "El archivo supera el tamaño máximo permitido."
        })
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise serializers.ValidationError({
            "archivo": "El archivo debe estar codificado en UTF-8."
        }) from error

    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text, newline=""), dialect=dialect)
    headers = reader.fieldnames
    if not headers or len(headers) != len(set(headers)):
        raise serializers.ValidationError({
            "archivo": "El CSV debe incluir encabezados únicos."
        })
    if not {"asset", "expected_return"}.issubset(headers):
        raise serializers.ValidationError({
            "archivo": (
                "Se requieren las columnas asset y expected_return, además "
                "de una columna cov:<activo> por cada activo."
            )
        })

    rows = []
    try:
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise serializers.ValidationError({
                    "archivo": "Todas las filas deben tener las mismas columnas."
                })
            if any((value or "").strip() for value in row.values()):
                rows.append(row)
            if len(rows) > settings.MAX_PORTFOLIO_ASSETS:
                raise serializers.ValidationError({
                    "archivo": (
                        f"El CSV supera el máximo de "
                        f"{settings.MAX_PORTFOLIO_ASSETS} activos."
                    )
                })
    except csv.Error as error:
        raise serializers.ValidationError({
            "archivo": "El archivo no tiene un formato CSV válido."
        }) from error
    if not rows:
        raise serializers.ValidationError({
            "archivo": "El CSV no contiene filas de activos."
        })

    assets = [(row.get("asset") or "").strip() for row in rows]
    covariance_headers = [f"cov:{asset}" for asset in assets]
    optional_headers = {"category", "min_weight", "max_weight"}
    expected_headers = {
        "asset",
        "expected_return",
        *covariance_headers,
        *(header for header in optional_headers if header in headers),
    }
    if set(headers) != expected_headers:
        raise serializers.ValidationError({
            "archivo": (
                "Las columnas de covarianza deben llamarse cov:<activo> y "
                "coincidir exactamente con los nombres de la columna asset. "
                "Solo se admiten también category, min_weight y max_weight."
            )
        })

    payload = {
        "nombre": name.strip() or Path(uploaded_file.name).stem[:150],
        "activos": assets,
        "categorias": [
            (row.get("category") or "").strip() for row in rows
        ],
        "rendimientos_esperados": [
            row["expected_return"].strip() for row in rows
        ],
        "covarianza": [
            [row[header].strip() for header in covariance_headers]
            for row in rows
        ],
        "aversion_riesgo": "1",
        "pesos_minimos": [
            (row.get("min_weight") or "0").strip() for row in rows
        ],
        "pesos_maximos": [
            (row.get("max_weight") or "1").strip() for row in rows
        ],
        "limites_categoria": {},
    }
    serializer = DatosPortafolioSerializer(data=payload)
    serializer.is_valid(raise_exception=True)
    return serializer.data
