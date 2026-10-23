
from decimal import Decimal

import pulp
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import (
    ProblemaOptimizacion,
    VariableDecision,
    TerminoObjetivo,
    Restriccion,
    TerminoRestriccion,
    EjecucionOptimizacion,
    ValorSolucion,
)


def resolver_problema(problema_id: int) -> EjecucionOptimizacion:
    """
    Construye y resuelve un problema lineal guardado en la base de datos.
    Guarda el estado, el valor objetivo y los valores de las variables.
    """

    problema = ProblemaOptimizacion.objects.get(pk=problema_id)

    ejecucion = EjecucionOptimizacion.objects.create(
        problema=problema,
        estado=EjecucionOptimizacion.Estado.PENDIENTE,
        solucionador="PuLP",
        mensaje="Preparando el modelo de optimización.",
    )

    try:
        variables_db = list(
            problema.variables.all().order_by("id")
        )
        terminos_objetivo = list(
            problema.terminos_objetivo.select_related("variable")
        )
        restricciones_db = list(
            problema.restricciones.prefetch_related(
                "terminos__variable"
            ).order_by("id")
        )

        if not variables_db:
            raise ValueError(
                "El problema debe tener al menos una variable."
            )

        if not terminos_objetivo:
            raise ValueError(
                "El problema debe tener al menos un término "
                "en la función objetivo."
            )

        if len(variables_db) > settings.OPTIMIZER_MAX_VARIABLES:
            raise ValueError("El modelo supera el límite de variables.")

        if len(restricciones_db) > settings.OPTIMIZER_MAX_CONSTRAINTS:
            raise ValueError("El modelo supera el límite de restricciones.")

        total_terminos = len(terminos_objetivo) + sum(
            len(restriccion.terminos.all())
            for restriccion in restricciones_db
        )
        if total_terminos > settings.OPTIMIZER_MAX_TERMS:
            raise ValueError("El modelo supera el límite de términos.")

        maximo_absoluto = Decimal(settings.OPTIMIZER_MAX_ABS_VALUE)
        valores = [
            termino.coeficiente for termino in terminos_objetivo
        ]
        valores.extend(
            restriccion.lado_derecho
            for restriccion in restricciones_db
        )
        for restriccion in restricciones_db:
            valores.extend(
                termino.coeficiente
                for termino in restriccion.terminos.all()
            )
        for variable in variables_db:
            valores.extend(
                limite
                for limite in (
                    variable.limite_inferior,
                    variable.limite_superior,
                )
                if limite is not None
            )
        if any(abs(valor) > maximo_absoluto for valor in valores):
            raise ValueError("El modelo supera el límite numérico permitido.")

        # Crear el modelo: maximización o minimización.
        sentido = (
            pulp.LpMaximize
            if problema.tipo_objetivo
            == ProblemaOptimizacion.TipoObjetivo.MAXIMIZAR
            else pulp.LpMinimize
        )

        modelo = pulp.LpProblem(problema.nombre, sentido)

        # Crear las variables de decisión.
        variables = {}

        tipos_pulp = {
            VariableDecision.TipoVariable.CONTINUA: pulp.LpContinuous,
            VariableDecision.TipoVariable.ENTERA: pulp.LpInteger,
            VariableDecision.TipoVariable.BINARIA: pulp.LpBinary,
        }

        for variable_db in variables_db:
            variable_db.full_clean()

            variables[variable_db.pk] = modelo.add_variable(
                f"x_{variable_db.pk}",
                lowBound=(
                    float(variable_db.limite_inferior)
                    if variable_db.limite_inferior is not None
                    else None
                ),
                upBound=(
                    float(variable_db.limite_superior)
                    if variable_db.limite_superior is not None
                    else None
                ),
                cat=tipos_pulp[variable_db.tipo],
            )

        # Construir la función objetivo.
        objetivo = []

        for termino in terminos_objetivo:
            termino.full_clean()

            if termino.variable_id not in variables:
                raise ValueError(
                    "La función objetivo contiene una variable "
                    "que no pertenece al problema."
                )

            objetivo.append(
                float(termino.coeficiente)
                * variables[termino.variable_id]
            )

        modelo += pulp.lpSum(objetivo), "Funcion_objetivo"

        # Agregar las restricciones.
        for restriccion_db in restricciones_db:
            expresion = []

            for termino in restriccion_db.terminos.all():
                termino.full_clean()

                if termino.variable_id not in variables:
                    raise ValueError(
                        f"La restricción '{restriccion_db.nombre}' "
                        "contiene una variable ajena al problema."
                    )

                expresion.append(
                    float(termino.coeficiente)
                    * variables[termino.variable_id]
                )

            lado_derecho = float(restriccion_db.lado_derecho)
            nombre = f"r_{restriccion_db.pk}"

            if restriccion_db.operador == Restriccion.Operador.MENOR_IGUAL:
                modelo += (
                    pulp.lpSum(expresion) <= lado_derecho,
                    nombre,
                )

            elif restriccion_db.operador == Restriccion.Operador.MAYOR_IGUAL:
                modelo += (
                    pulp.lpSum(expresion) >= lado_derecho,
                    nombre,
                )

            elif restriccion_db.operador == Restriccion.Operador.IGUAL:
                modelo += (
                    pulp.lpSum(expresion) == lado_derecho,
                    nombre,
                )

            else:
                raise ValueError(
                    f"Operador no reconocido en "
                    f"'{restriccion_db.nombre}'."
                )

        # Ejecutar el solucionador de PuLP.
        estadisticas = modelo.solve(
            pulp.COIN_CMD(
                msg=False,
                timeLimit=settings.OPTIMIZER_TIME_LIMIT_SECONDS,
                threads=1,
            )
        )

        estado_pulp = estadisticas.status_str

        equivalencias = {
            "Optimal": EjecucionOptimizacion.Estado.OPTIMO,
            "Infeasible": EjecucionOptimizacion.Estado.INFACTIBLE,
            "Unbounded": EjecucionOptimizacion.Estado.NO_ACOTADO,
            "TimeLimit": EjecucionOptimizacion.Estado.LIMITE_TIEMPO,
        }

        estado = equivalencias.get(
            estado_pulp,
            EjecucionOptimizacion.Estado.ERROR,
        )

        mensaje = f"Estado informado por PuLP: {estado_pulp}."

        valor_objetivo = None
        valores_guardar = []

        # Solo almacenar una solución cuando PuLP informa óptimo.
        if estado == EjecucionOptimizacion.Estado.OPTIMO:
            valor = pulp.value(modelo.objective)

            if valor is None:
                raise ValueError(
                    "PuLP informó un resultado óptimo, pero no "
                    "devolvió el valor de la función objetivo."
                )

            valor_objetivo = Decimal(str(valor))

            for variable_db in variables_db:
                valor_variable = variables[
                    variable_db.pk
                ].varValue

                if valor_variable is None:
                    raise ValueError(
                        f"No se obtuvo un valor para "
                        f"'{variable_db.nombre}'."
                    )

                valores_guardar.append(
                    ValorSolucion(
                        ejecucion=ejecucion,
                        variable=variable_db,
                        valor=Decimal(str(valor_variable)),
                    )
                )

        # Guardar el resultado de forma atómica.
        with transaction.atomic():
            if valores_guardar:
                ValorSolucion.objects.bulk_create(valores_guardar)

            ejecucion.estado = estado
            ejecucion.valor_objetivo = valor_objetivo
            ejecucion.mensaje = mensaje
            ejecucion.detalles = {
                "estado_pulp": estado_pulp,
                "variables": len(variables_db),
                "restricciones": len(restricciones_db),
                "terminos_objetivo": len(terminos_objetivo),
            }
            ejecucion.finalizada_en = timezone.now()
            ejecucion.save()

    except Exception as error:
        # Registrar el error para poder identificar su causa.
        ejecucion.estado = EjecucionOptimizacion.Estado.ERROR
        ejecucion.valor_objetivo = None
        ejecucion.mensaje = (
            f"{type(error).__name__}: {error}"
        )
        ejecucion.detalles = {
            "tipo_error": type(error).__name__,
        }
        ejecucion.finalizada_en = timezone.now()
        ejecucion.save()

    return ejecucion
