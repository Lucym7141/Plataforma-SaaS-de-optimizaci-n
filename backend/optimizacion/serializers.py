
from decimal import Decimal

from rest_framework import serializers
from django.db import transaction
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.contrib.auth.password_validation import validate_password
from django.conf import settings
import numpy as np
from scipy.optimize import linprog

from .models import (
    ProblemaOptimizacion,
    OptimizacionPortafolio,
    EjecucionPortafolio,
    VariableDecision,
    TerminoObjetivo,
    Restriccion,
    TerminoRestriccion,
    EjecucionOptimizacion,
    ValorSolucion,
)

Usuario = get_user_model()


class RegistroUsuarioSerializer(serializers.ModelSerializer):
    email = serializers.EmailField()
    password = serializers.CharField(
        write_only=True,
        trim_whitespace=False,
        style={"input_type": "password"},
    )

    class Meta:
        model = Usuario
        fields = ["id", "username", "email", "password"]

    def validate(self, attrs):
        if Usuario.objects.filter(email__iexact=attrs["email"]).exists():
            raise serializers.ValidationError({
                "email": "Ya existe una cuenta asociada a ese correo."
            })
        usuario = Usuario(
            username=attrs["username"],
            email=attrs.get("email", ""),
        )
        try:
            validate_password(attrs["password"], user=usuario)
        except DjangoValidationError as error:
            raise serializers.ValidationError({
                "password": error.messages,
            }) from error
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        usuario = Usuario.objects.create_user(
            password=password,
            is_active=False,
            **validated_data,
        )
        from .models import VerificacionCorreo

        VerificacionCorreo.objects.create(usuario=usuario)
        return usuario


class VariableDecisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = VariableDecision
        fields = [
            "id",
            "nombre",
            "descripcion",
            "unidad",
            "tipo",
            "limite_inferior",
            "limite_superior",
            "metadatos",
        ]


class TerminoObjetivoSerializer(serializers.ModelSerializer):
    variable_nombre = serializers.CharField(
        source="variable.nombre",
        read_only=True,
    )

    class Meta:
        model = TerminoObjetivo
        fields = [
            "id",
            "variable",
            "variable_nombre",
            "coeficiente",
        ]


class TerminoRestriccionSerializer(serializers.ModelSerializer):
    variable_nombre = serializers.CharField(
        source="variable.nombre",
        read_only=True,
    )

    class Meta:
        model = TerminoRestriccion
        fields = [
            "id",
            "variable",
            "variable_nombre",
            "coeficiente",
        ]


class RestriccionSerializer(serializers.ModelSerializer):
    terminos = TerminoRestriccionSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = Restriccion
        fields = [
            "id",
            "nombre",
            "descripcion",
            "operador",
            "lado_derecho",
            "terminos",
        ]


class ValorSolucionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ValorSolucion
        fields = [
            "variable",
            "variable_nombre",
            "valor",
        ]


class EjecucionOptimizacionSerializer(serializers.ModelSerializer):
    valores = ValorSolucionSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = EjecucionOptimizacion
        fields = [
            "id",
            "problema",
            "estado",
            "solucionador",
            "valor_objetivo",
            "mensaje",
            "detalles",
            "modelo_snapshot",
            "iniciada_en",
            "finalizada_en",
            "valores",
        ]


class DatosPortafolioSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=150)
    activos = serializers.ListField(
        child=serializers.CharField(max_length=100),
        allow_empty=False,
    )
    categorias = serializers.ListField(
        child=serializers.CharField(max_length=100, allow_blank=True),
        required=False,
    )
    rendimientos_esperados = serializers.ListField(
        child=serializers.DecimalField(max_digits=12, decimal_places=8),
        allow_empty=False,
    )
    covarianza = serializers.ListField(
        child=serializers.ListField(
            child=serializers.DecimalField(max_digits=12, decimal_places=8),
            allow_empty=False,
        ),
        allow_empty=False,
    )
    aversion_riesgo = serializers.DecimalField(
        max_digits=12,
        decimal_places=6,
        min_value=Decimal("0.000001"),
        max_value=Decimal("999999.999999"),
    )
    periodos_por_anio = serializers.ChoiceField(
        choices=[1, 12, 52, 252, 365],
        required=False,
        default=1,
    )
    escenarios_estres = serializers.DictField(
        child=serializers.ListField(
            child=serializers.DecimalField(
                max_digits=12,
                decimal_places=8,
                min_value=Decimal("-100"),
                max_value=Decimal("100"),
            ),
            allow_empty=False,
        ),
        required=False,
        default=dict,
    )
    pesos_minimos = serializers.ListField(
        child=serializers.DecimalField(max_digits=9, decimal_places=8),
        required=False,
    )
    pesos_maximos = serializers.ListField(
        child=serializers.DecimalField(max_digits=9, decimal_places=8),
        required=False,
    )
    limites_categoria = serializers.DictField(
        child=serializers.DecimalField(
            max_digits=9,
            decimal_places=8,
            min_value=Decimal("0"),
            max_value=Decimal("1"),
        ),
        required=False,
    )

    def validate_activos(self, value):
        if not 2 <= len(value) <= settings.MAX_PORTFOLIO_ASSETS:
            raise serializers.ValidationError(
                f"Se requieren de 2 a {settings.MAX_PORTFOLIO_ASSETS} activos."
            )
        normalized = [asset.strip().casefold() for asset in value]
        if any(not asset for asset in normalized):
            raise serializers.ValidationError(
                "Los nombres de activos no pueden estar vacíos."
            )
        if len(normalized) != len(set(normalized)):
            raise serializers.ValidationError(
                "Los nombres de activos deben ser únicos."
            )
        return [asset.strip() for asset in value]

    def validate(self, attrs):
        count = len(attrs["activos"])
        returns = attrs["rendimientos_esperados"]
        covariance = attrs["covarianza"]

        if len(returns) != count:
            raise serializers.ValidationError({
                "rendimientos_esperados": (
                    "Debe indicarse un rendimiento esperado por cada activo."
                )
            })
        scenarios = attrs.get("escenarios_estres", {})
        if len(scenarios) > 20:
            raise serializers.ValidationError({
                "escenarios_estres": "Se admiten hasta 20 escenarios de estrés."
            })
        normalized_scenarios = {}
        for label, scenario_returns in scenarios.items():
            normalized_label = label.strip()
            if not normalized_label or len(normalized_label) > 100:
                raise serializers.ValidationError({
                    "escenarios_estres": (
                        "Cada escenario requiere un nombre de 1 a 100 caracteres."
                    )
                })
            if len(scenario_returns) != count:
                raise serializers.ValidationError({
                    "escenarios_estres": (
                        f"El escenario '{normalized_label}' debe especificar "
                        "un rendimiento por activo."
                    )
                })
            if normalized_label in normalized_scenarios:
                raise serializers.ValidationError({
                    "escenarios_estres": "Los nombres de escenario deben ser únicos."
                })
            normalized_scenarios[normalized_label] = scenario_returns
        if len(covariance) != count or any(
            len(row) != count for row in covariance
        ):
            raise serializers.ValidationError({
                "covarianza": (
                    "La matriz de covarianza debe ser cuadrada y corresponder "
                    "al número de activos."
                )
            })

        categories = attrs.get("categorias", [""] * count)
        if len(categories) != count:
            raise serializers.ValidationError({
                "categorias": "Debe indicarse una categoría por cada activo."
            })
        categories = [category.strip() for category in categories]
        limits = attrs.get("limites_categoria", {})
        known_categories = set(categories) - {""}
        if set(limits) - known_categories:
            raise serializers.ValidationError({
                "limites_categoria": (
                    "Los límites solo pueden referirse a categorías asignadas."
                )
            })

        minimums = attrs.get("pesos_minimos", [Decimal("0")] * count)
        maximums = attrs.get("pesos_maximos", [Decimal("1")] * count)
        if len(minimums) != count or len(maximums) != count:
            raise serializers.ValidationError({
                "pesos_minimos": (
                    "Debe indicarse un peso mínimo y máximo por cada activo."
                ),
                "pesos_maximos": (
                    "Debe indicarse un peso mínimo y máximo por cada activo."
                ),
            })
        if any(
            lower < 0 or upper > 1 or lower > upper
            for lower, upper in zip(minimums, maximums)
        ):
            raise serializers.ValidationError({
                "pesos_minimos": (
                    "Los pesos deben estar entre 0 y 1 y el mínimo no "
                    "puede superar el máximo."
                )
            })
        if sum(minimums) > 1 or sum(maximums) < 1:
            raise serializers.ValidationError({
                "pesos_minimos": (
                    "Los límites de peso no permiten que la cartera sume 100 %."
                )
            })
        for category, cap in limits.items():
            lower_total = sum(
                minimums[index]
                for index, name in enumerate(categories)
                if name == category
            )
            if lower_total > cap:
                raise serializers.ValidationError({
                    "limites_categoria": (
                        f"El límite de '{category}' es inferior a los pesos "
                        "mínimos de sus activos."
                    )
                })

        category_matrix = [
            [1.0 if category == name else 0.0 for name in categories]
            for category in limits
        ]
        feasible = linprog(
            c=[0.0] * count,
            A_ub=category_matrix or None,
            b_ub=[float(cap) for cap in limits.values()] or None,
            A_eq=[[1.0] * count],
            b_eq=[1.0],
            bounds=[
                (float(lower), float(upper))
                for lower, upper in zip(minimums, maximums)
            ],
            method="highs",
        )
        if not feasible.success:
            raise serializers.ValidationError({
                "limites_categoria": (
                    "Los límites por activo y categoría no permiten una "
                    "cartera que sume 100 %."
                )
            })

        attrs["categorias"] = categories
        attrs["pesos_minimos"] = minimums
        attrs["pesos_maximos"] = maximums
        attrs["limites_categoria"] = limits
        attrs["escenarios_estres"] = normalized_scenarios

        max_value = 100
        if any(abs(value) > max_value for value in returns):
            raise serializers.ValidationError({
                "rendimientos_esperados": (
                    "Los rendimientos deben expresarse como fracciones "
                    "y estar entre -100 y 100."
                )
            })
        if any(abs(value) > max_value for row in covariance for value in row):
            raise serializers.ValidationError({
                "covarianza": "Los valores de covarianza deben estar entre -100 y 100."
            })

        matrix = np.asarray(covariance, dtype=float)
        if not np.allclose(matrix, matrix.T, rtol=1e-9, atol=1e-10):
            raise serializers.ValidationError({
                "covarianza": "La matriz debe ser simétrica."
            })
        if np.linalg.eigvalsh((matrix + matrix.T) / 2).min() < -1e-10:
            raise serializers.ValidationError({
                "covarianza": (
                    "La matriz debe ser positiva semidefinida."
                )
            })
        return attrs


class OptimizacionPortafolioSerializer(serializers.ModelSerializer):
    class Meta:
        model = OptimizacionPortafolio
        fields = [
            "id",
            "nombre",
            "activos",
            "categorias",
            "rendimientos_esperados",
            "covarianza",
            "aversion_riesgo",
            "periodos_por_anio",
            "pesos_minimos",
            "pesos_maximos",
            "limites_categoria",
            "escenarios_estres",
            "archivado",
            "creado_en",
            "actualizado_en",
        ]
        read_only_fields = ["id", "archivado", "creado_en", "actualizado_en"]


class EjecucionPortafolioSerializer(serializers.ModelSerializer):
    class Meta:
        model = EjecucionPortafolio
        fields = [
            "id",
            "estado",
            "modelo_snapshot",
            "rendimientos_portafolio",
            "varianza_portafolio",
            "volatilidad_portafolio",
            "utilidad_riesgo",
            "ponderaciones",
            "contribuciones_riesgo",
            "rendimiento_anualizado",
            "volatilidad_anualizada",
            "resultados_estres",
            "creada_en",
        ]


class ProblemaOptimizacionSerializer(serializers.ModelSerializer):
    variables = VariableDecisionSerializer(
        many=True,
        read_only=True,
    )
    terminos_objetivo = TerminoObjetivoSerializer(
        many=True,
        read_only=True,
    )
    restricciones = RestriccionSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = ProblemaOptimizacion
        fields = [
            "id",
            "nombre",
            "descripcion",
            "tipo_objetivo",
            "activo",
            "creado_en",
            "actualizado_en",
            "variables",
            "terminos_objetivo",
            "restricciones",
        ]



class TerminoObjetivoCrearSerializer(serializers.Serializer):
    variable_nombre = serializers.CharField(max_length=100)
    coeficiente = serializers.DecimalField(
        max_digits=20,
        decimal_places=6,
    )


class TerminoRestriccionCrearSerializer(serializers.Serializer):
    variable_nombre = serializers.CharField(max_length=100)
    coeficiente = serializers.DecimalField(
        max_digits=20,
        decimal_places=6,
    )


class RestriccionCrearSerializer(serializers.Serializer):
    nombre = serializers.CharField(max_length=150)
    descripcion = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
    )
    operador = serializers.ChoiceField(
        choices=Restriccion.Operador.choices,
    )
    lado_derecho = serializers.DecimalField(
        max_digits=20,
        decimal_places=6,
    )
    terminos = TerminoRestriccionCrearSerializer(
        many=True,
        allow_empty=False,
    )

    def validate_terminos(self, value):
        nombres = [termino["variable_nombre"] for termino in value]

        if len(nombres) != len(set(nombres)):
            raise serializers.ValidationError(
                "Una variable no puede repetirse en la misma restricción."
            )

        return value


class ProblemaOptimizacionCrearSerializer(serializers.ModelSerializer):
    variables = VariableDecisionSerializer(
        many=True,
        allow_empty=False,
    )
    terminos_objetivo = TerminoObjetivoCrearSerializer(
        many=True,
        allow_empty=False,
    )
    restricciones = RestriccionCrearSerializer(
        many=True,
        required=False,
        default=list,
    )

    class Meta:
        model = ProblemaOptimizacion
        fields = [
            "id",
            "nombre",
            "descripcion",
            "tipo_objetivo",
            "variables",
            "terminos_objetivo",
            "restricciones",
        ]

    def validate_variables(self, value):
        if len(value) > settings.OPTIMIZER_MAX_VARIABLES:
            raise serializers.ValidationError(
                f"El modelo supera el máximo de "
                f"{settings.OPTIMIZER_MAX_VARIABLES} variables."
            )

        nombres = [variable["nombre"] for variable in value]

        if len(nombres) != len(set(nombres)):
            raise serializers.ValidationError(
                "Los nombres de las variables deben ser únicos."
            )

        for variable in value:
            inferior = variable.get("limite_inferior")
            superior = variable.get("limite_superior")
            tipo = variable.get("tipo", "CONT")

            if any(
                bound is not None
                and abs(bound) > settings.OPTIMIZER_MAX_ABS_VALUE
                for bound in (inferior, superior)
            ):
                raise serializers.ValidationError(
                    f"Los límites de '{variable['nombre']}' superan el "
                    f"valor absoluto máximo de "
                    f"{settings.OPTIMIZER_MAX_ABS_VALUE}."
                )

            if (
                inferior is not None
                and superior is not None
                and inferior > superior
            ):
                raise serializers.ValidationError(
                    f"El límite inferior de '{variable['nombre']}' "
                    "no puede superar el límite superior."
                )

            if tipo == "BIN":
                if inferior not in (None, 0):
                    raise serializers.ValidationError(
                        f"La variable binaria '{variable['nombre']}' "
                        "debe tener límite inferior 0."
                    )

                if superior not in (None, 1):
                    raise serializers.ValidationError(
                        f"La variable binaria '{variable['nombre']}' "
                        "debe tener límite superior 1."
                    )

        return value

    def validate(self, attrs):
        restricciones = attrs.get("restricciones", [])
        if len(restricciones) > settings.OPTIMIZER_MAX_CONSTRAINTS:
            raise serializers.ValidationError({
                "restricciones": (
                    f"El modelo supera el máximo de "
                    f"{settings.OPTIMIZER_MAX_CONSTRAINTS} restricciones."
                )
            })

        nombres_variables = {
            variable["nombre"] for variable in attrs["variables"]
        }

        nombres_objetivo = [
            termino["variable_nombre"]
            for termino in attrs["terminos_objetivo"]
        ]

        if len(nombres_objetivo) != len(set(nombres_objetivo)):
            raise serializers.ValidationError({
                "terminos_objetivo": (
                    "Una variable no puede repetirse en la función objetivo."
                )
            })

        for nombre in nombres_objetivo:
            if nombre not in nombres_variables:
                raise serializers.ValidationError({
                    "terminos_objetivo": (
                        f"La variable '{nombre}' no está definida."
                    )
                })

        total_terminos = len(attrs["terminos_objetivo"])
        valores = [
            termino["coeficiente"]
            for termino in attrs["terminos_objetivo"]
        ]
        valores.extend(
            restriccion["lado_derecho"]
            for restriccion in restricciones
        )

        nombres_restricciones = [restriccion["nombre"] for restriccion in restricciones]

        if len(nombres_restricciones) != len(set(nombres_restricciones)):
            raise serializers.ValidationError({
                "restricciones": (
                    "Los nombres de las restricciones deben ser únicos."
                )
            })

        for restriccion in restricciones:
            total_terminos += len(restriccion["terminos"])
            valores.extend(
                termino["coeficiente"]
                for termino in restriccion["terminos"]
            )
            for termino in restriccion["terminos"]:
                nombre = termino["variable_nombre"]

                if nombre not in nombres_variables:
                    raise serializers.ValidationError({
                        "restricciones": (
                            f"La variable '{nombre}' de la restricción "
                            f"'{restriccion['nombre']}' no está definida."
                        )
                    })

        if total_terminos > settings.OPTIMIZER_MAX_TERMS:
            raise serializers.ValidationError({
                "terminos_objetivo": (
                    f"El modelo supera el máximo de "
                    f"{settings.OPTIMIZER_MAX_TERMS} términos."
                )
            })

        if any(
            abs(value) > settings.OPTIMIZER_MAX_ABS_VALUE
            for value in valores
        ):
            raise serializers.ValidationError(
                "Los coeficientes y lados derechos no pueden superar "
                f"el valor absoluto de {settings.OPTIMIZER_MAX_ABS_VALUE}."
            )

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        variables_data = validated_data.pop("variables")
        objetivo_data = validated_data.pop("terminos_objetivo")
        restricciones_data = validated_data.pop("restricciones", [])

        problema = ProblemaOptimizacion.objects.create(
            propietario=self.context["request"].user,
            **validated_data
        )

        self._create_components(
            problema,
            variables_data,
            objetivo_data,
            restricciones_data,
        )
        return problema

    @transaction.atomic
    def update(self, instance, validated_data):
        variables_data = validated_data.pop("variables")
        objetivo_data = validated_data.pop("terminos_objetivo")
        restricciones_data = validated_data.pop("restricciones", [])

        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        instance.terminos_objetivo.all().delete()
        instance.restricciones.all().delete()
        instance.variables.all().delete()
        self._create_components(
            instance,
            variables_data,
            objetivo_data,
            restricciones_data,
        )
        return instance

    @staticmethod
    def _create_components(
        problema,
        variables_data,
        objetivo_data,
        restricciones_data,
    ):
        variables_por_nombre = {}

        for datos in variables_data:
            variable = VariableDecision.objects.create(
                problema=problema,
                **datos,
            )
            variables_por_nombre[variable.nombre] = variable

        for termino in objetivo_data:
            TerminoObjetivo.objects.create(
                problema=problema,
                variable=variables_por_nombre[
                    termino["variable_nombre"]
                ],
                coeficiente=termino["coeficiente"],
            )

        for datos_restriccion in restricciones_data:
            terminos = datos_restriccion.pop("terminos")

            restriccion = Restriccion.objects.create(
                problema=problema,
                **datos_restriccion,
            )

            for termino in terminos:
                TerminoRestriccion.objects.create(
                    restriccion=restriccion,
                    variable=variables_por_nombre[
                        termino["variable_nombre"]
                    ],
                    coeficiente=termino["coeficiente"],
                )
from decimal import Decimal
