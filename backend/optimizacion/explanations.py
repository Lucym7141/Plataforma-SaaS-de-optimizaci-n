"""Hechos calculados que se envían a la IA para explicar un resultado.

La IA solo redacta: todas las cifras salen de aquí, calculadas a partir de la
ejecución guardada, para que la explicación no pueda inventar números.
"""

from .models import EjecucionOptimizacion

ESTADOS = dict(EjecucionOptimizacion.Estado.choices)
OPERADORES = {"LE": "<=", "GE": ">=", "EQ": "="}
TIPOS_VARIABLE = {"CONT": "continua", "ENT": "entera", "BIN": "binaria"}
EXPLICABLES = {
    EjecucionOptimizacion.Estado.OPTIMO,
    EjecucionOptimizacion.Estado.INFACTIBLE,
    EjecucionOptimizacion.Estado.NO_ACOTADO,
    EjecucionOptimizacion.Estado.LIMITE_TIEMPO,
}


def _numero(valor):
    if valor is None or valor == "":
        return None
    return round(float(valor), 6)


def _formula(terminos):
    partes = [
        f"{_numero(termino['coeficiente'])}*{termino['variable_nombre']}"
        for termino in terminos
    ]
    return " + ".join(partes) or "0"


def hechos_problema(ejecucion):
    snapshot = ejecucion.modelo_snapshot or {}
    valores = {
        valor.variable_nombre: _numero(valor.valor)
        for valor in ejecucion.valores.all()
    }
    variables = []
    for variable in snapshot.get("variables", []):
        valor = valores.get(variable["nombre"])
        inferior = _numero(variable.get("limite_inferior"))
        superior = _numero(variable.get("limite_superior"))
        variables.append({
            "nombre": variable["nombre"],
            "tipo": TIPOS_VARIABLE.get(variable.get("tipo"), variable.get("tipo")),
            "valor": valor,
            "limite_inferior": inferior,
            "limite_superior": superior,
            "en_limite_inferior": valor is not None and inferior is not None
            and abs(valor - inferior) <= 1e-6,
            "en_limite_superior": valor is not None and superior is not None
            and abs(valor - superior) <= 1e-6,
        })

    analisis = {
        item["nombre"]: item
        for item in (ejecucion.detalles or {}).get("restricciones_analisis", [])
    }
    restricciones = []
    for restriccion in snapshot.get("restricciones", []):
        item = {
            "nombre": restriccion["nombre"],
            "definicion": (
                f"{_formula(restriccion.get('terminos', []))} "
                f"{OPERADORES.get(restriccion['operador'], restriccion['operador'])} "
                f"{_numero(restriccion['lado_derecho'])}"
            ),
        }
        resultado = analisis.get(restriccion["nombre"])
        if resultado:
            item.update({
                "uso": resultado["lado_izquierdo"],
                "holgura": resultado["holgura"],
                "activa": resultado["activa"],
                "precio_sombra": resultado["precio_sombra"],
            })
        restricciones.append(item)

    return {
        "tipo": "modelo",
        "nombre": snapshot.get("nombre", ""),
        "objetivo": (
            ("Maximizar " if snapshot.get("tipo_objetivo") == "MAX" else "Minimizar ")
            + _formula(snapshot.get("terminos_objetivo", []))
        ),
        "estado": ESTADOS.get(ejecucion.estado, ejecucion.estado),
        "valor_objetivo": _numero(ejecucion.valor_objetivo),
        "mensaje_solucionador": ejecucion.mensaje,
        "variables": variables,
        "restricciones": restricciones,
        "analisis_de_restricciones_disponible": bool(analisis),
    }


def hechos_portafolio(ejecucion):
    snapshot = ejecucion.modelo_snapshot or {}
    activos = snapshot.get("activos", [])
    count = len(activos)
    categorias = snapshot.get("categorias") or [""] * count
    minimos = snapshot.get("pesos_minimos") or [0] * count
    maximos = snapshot.get("pesos_maximos") or [1] * count
    rendimientos = snapshot.get("rendimientos_esperados") or [0] * count
    contribuciones = ejecucion.contribuciones_riesgo or [{}] * count

    detalle_activos = []
    for index, nombre in enumerate(activos):
        peso = _numero(ejecucion.ponderaciones[index])
        minimo = _numero(minimos[index])
        maximo = _numero(maximos[index])
        detalle_activos.append({
            "activo": nombre,
            "categoria": categorias[index] or None,
            "rendimiento_esperado_periodo": _numero(rendimientos[index]),
            "peso_optimo": peso,
            "peso_minimo": minimo,
            "peso_maximo": maximo,
            "en_peso_minimo": abs(peso - minimo) <= 1e-6,
            "en_peso_maximo": abs(peso - maximo) <= 1e-6,
            "proporcion_del_riesgo": _numero(
                contribuciones[index].get("proporcion_volatilidad")
            ),
        })

    pesos_por_categoria = {}
    for item in detalle_activos:
        if item["categoria"]:
            pesos_por_categoria[item["categoria"]] = round(
                pesos_por_categoria.get(item["categoria"], 0) + item["peso_optimo"], 6
            )
    limites_categoria = [
        {
            "categoria": categoria,
            "limite": _numero(limite),
            "peso_optimo": pesos_por_categoria.get(categoria, 0.0),
            "activo_el_limite": abs(
                pesos_por_categoria.get(categoria, 0.0) - float(limite)
            ) <= 1e-6,
        }
        for categoria, limite in (snapshot.get("limites_categoria") or {}).items()
    ]
    mayor = max(detalle_activos, key=lambda item: item["peso_optimo"], default=None)

    return {
        "tipo": "portafolio",
        "nombre": snapshot.get("nombre", ""),
        "aversion_al_riesgo": _numero(snapshot.get("aversion_riesgo")),
        "periodos_por_anio": snapshot.get("periodos_por_anio"),
        "rendimiento_esperado_periodo": _numero(ejecucion.rendimientos_portafolio),
        "volatilidad_periodo": _numero(ejecucion.volatilidad_portafolio),
        "rendimiento_anualizado_aprox": _numero(ejecucion.rendimiento_anualizado),
        "volatilidad_anualizada_aprox": _numero(ejecucion.volatilidad_anualizada),
        "activo_con_mayor_peso": (
            {"activo": mayor["activo"], "peso": mayor["peso_optimo"]}
            if mayor
            else None
        ),
        "activos": detalle_activos,
        "limites_por_categoria": limites_categoria,
        "escenarios_de_estres": {
            nombre: _numero(valor)
            for nombre, valor in (ejecucion.resultados_estres or {}).items()
        },
    }
