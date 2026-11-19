"""Convierte los datos que la IA extrajo de un texto en un borrador de portafolio.

La IA solo transcribe números; aquí se hacen todas las cuentas (porcentajes a
fracciones y covarianza a partir de volatilidades y correlaciones) de forma
determinista, para que el borrador no dependa de aritmética del modelo.
"""

import math

DEFAULT_RISK_AVERSION = 1
ALLOWED_PERIODS = {1, 12, 52, 252, 365}


class BorradorIncompleto(Exception):
    """Faltan datos indispensables; `faltantes` dice cuáles."""

    def __init__(self, faltantes):
        super().__init__("Faltan datos para armar el portafolio.")
        self.faltantes = faltantes


class BorradorInvalido(Exception):
    """La respuesta de la IA no tiene la estructura esperada."""


def _numero(valor, *, opcional=False):
    if valor is None and opcional:
        return None
    if isinstance(valor, bool):
        raise BorradorInvalido("Número inválido.")
    if isinstance(valor, str):
        valor = valor.strip().replace("%", "").replace(",", ".")
    try:
        numero = float(valor)
    except (TypeError, ValueError) as error:
        raise BorradorInvalido("Número inválido.") from error
    if not math.isfinite(numero):
        raise BorradorInvalido("Número inválido.")
    return numero


def _redondear(valor):
    # Los campos del portafolio admiten hasta 8 decimales.
    return round(valor, 8) + 0.0


def _textos(valores, maximo=10, largo=300):
    if not isinstance(valores, list):
        return []
    return [
        valor.strip()[:largo]
        for valor in valores[:maximo]
        if isinstance(valor, str) and valor.strip()
    ]


def _matriz(valor, n):
    if valor is None:
        return None
    if not isinstance(valor, list) or len(valor) != n:
        raise BorradorInvalido("Matriz con dimensiones incorrectas.")
    filas = []
    for fila in valor:
        if not isinstance(fila, list) or len(fila) != n:
            raise BorradorInvalido("Matriz con dimensiones incorrectas.")
        filas.append([_numero(celda) for celda in fila])
    return filas


def construir_borrador(datos):
    """Devuelve (payload, supuestos) listo para DatosPortafolioSerializer."""
    if not isinstance(datos, dict):
        raise BorradorInvalido("La respuesta no es un objeto.")

    faltantes = _textos(datos.get("faltantes"))
    if faltantes:
        raise BorradorIncompleto(faltantes)

    activos = datos.get("activos")
    if not isinstance(activos, list) or not all(
        isinstance(activo, dict) for activo in activos
    ):
        raise BorradorInvalido("Faltan los activos.")
    n = len(activos)
    if n < 2:
        raise BorradorIncompleto(["Al menos dos activos con sus datos."])

    escala = 0.01 if datos.get("formato") == "porcentaje" else 1.0
    supuestos = _textos(datos.get("supuestos"))

    nombres = []
    categorias = []
    rendimientos = []
    volatilidades = []
    minimos = []
    maximos = []
    sin_rendimiento = []
    for activo in activos:
        nombre = str(activo.get("nombre") or "").strip()[:100]
        if not nombre:
            raise BorradorInvalido("Activo sin nombre.")
        nombres.append(nombre)
        categoria = activo.get("categoria")
        categorias.append(str(categoria).strip()[:100] if categoria else "")
        rendimiento = _numero(activo.get("rendimiento_esperado"), opcional=True)
        if rendimiento is None:
            sin_rendimiento.append(nombre)
        else:
            rendimientos.append(_redondear(rendimiento * escala))
        volatilidad = _numero(activo.get("volatilidad"), opcional=True)
        volatilidades.append(None if volatilidad is None else volatilidad * escala)
        minimo = _numero(activo.get("peso_minimo"), opcional=True)
        maximo = _numero(activo.get("peso_maximo"), opcional=True)
        minimos.append(_redondear(0.0 if minimo is None else minimo * escala))
        maximos.append(_redondear(1.0 if maximo is None else maximo * escala))

    if sin_rendimiento:
        raise BorradorIncompleto([
            f"Rendimiento esperado de {nombre}." for nombre in sin_rendimiento
        ])

    covarianza = _matriz(datos.get("covarianza"), n)
    if covarianza is None:
        if any(volatilidad is None for volatilidad in volatilidades):
            raise BorradorIncompleto([
                "La volatilidad de cada activo o la matriz de covarianza."
            ])
        correlaciones = _matriz(datos.get("correlaciones"), n)
        if correlaciones is None:
            if datos.get("sin_correlacion") is not True:
                raise BorradorIncompleto([
                    "Las correlaciones entre activos, o indicar que no están "
                    "correlacionados."
                ])
            correlaciones = [
                [1.0 if i == j else 0.0 for j in range(n)] for i in range(n)
            ]
            supuestos.append(
                "Como indicaste que los activos no están correlacionados, se "
                "usó correlación 0 entre ellos."
            )
        if any(abs(valor) > 1 for fila in correlaciones for valor in fila):
            raise BorradorInvalido("Correlación fuera de [-1, 1].")
        covarianza = [
            [
                volatilidades[i]
                * volatilidades[j]
                * (1.0 if i == j else correlaciones[i][j])
                for j in range(n)
            ]
            for i in range(n)
        ]
        supuestos.append(
            "La covarianza se calculó a partir de las volatilidades y "
            "correlaciones indicadas."
        )
    covarianza = [[_redondear(valor) for valor in fila] for fila in covarianza]

    limites = datos.get("limites_categoria") or {}
    if not isinstance(limites, dict):
        raise BorradorInvalido("Límites por categoría inválidos.")
    escenarios = datos.get("escenarios_estres") or {}
    if not isinstance(escenarios, dict):
        raise BorradorInvalido("Escenarios inválidos.")

    aversion = _numero(datos.get("aversion_riesgo"), opcional=True)
    if aversion is None or aversion <= 0:
        aversion = DEFAULT_RISK_AVERSION
        supuestos.append(
            f"Se usó una aversión al riesgo de {DEFAULT_RISK_AVERSION} (valor "
            "por defecto); ajústala según tu tolerancia al riesgo."
        )
    periodos = datos.get("periodos_por_anio")
    if periodos not in ALLOWED_PERIODS:
        periodos = 1

    payload = {
        "nombre": str(datos.get("nombre") or "Portafolio generado con IA").strip()[:150],
        "activos": nombres,
        "categorias": categorias,
        "rendimientos_esperados": rendimientos,
        "covarianza": covarianza,
        "aversion_riesgo": aversion,
        "periodos_por_anio": periodos,
        "pesos_minimos": minimos,
        "pesos_maximos": maximos,
        "limites_categoria": {
            str(categoria).strip()[:100]: _redondear(_numero(limite) * escala)
            for categoria, limite in limites.items()
        },
        "escenarios_estres": {
            str(nombre).strip()[:100]: [
                _redondear(_numero(valor) * escala) for valor in valores
            ]
            for nombre, valores in escenarios.items()
            if isinstance(valores, list)
        },
    }
    return payload, supuestos
