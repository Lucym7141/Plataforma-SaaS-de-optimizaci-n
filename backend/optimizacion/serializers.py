
from rest_framework import serializers
from django.db import transaction

from .models import (
    ProblemaOptimizacion,
    VariableDecision,
    TerminoObjetivo,
    Restriccion,
    TerminoRestriccion,
    EjecucionOptimizacion,
    ValorSolucion,
)


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
    variable_nombre = serializers.CharField(
        source="variable.nombre",
        read_only=True,
    )

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
            "iniciada_en",
            "finalizada_en",
            "valores",
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
        nombres = [variable["nombre"] for variable in value]

        if len(nombres) != len(set(nombres)):
            raise serializers.ValidationError(
                "Los nombres de las variables deben ser únicos."
            )

        for variable in value:
            inferior = variable.get("limite_inferior")
            superior = variable.get("limite_superior")
            tipo = variable.get("tipo", "CONT")

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

        nombres_restricciones = [
            restriccion["nombre"] for restriccion in attrs.get(
                "restricciones", []
            )
        ]

        if len(nombres_restricciones) != len(set(nombres_restricciones)):
            raise serializers.ValidationError({
                "restricciones": (
                    "Los nombres de las restricciones deben ser únicos."
                )
            })

        for restriccion in attrs.get("restricciones", []):
            for termino in restriccion["terminos"]:
                nombre = termino["variable_nombre"]

                if nombre not in nombres_variables:
                    raise serializers.ValidationError({
                        "restricciones": (
                            f"La variable '{nombre}' de la restricción "
                            f"'{restriccion['nombre']}' no está definida."
                        )
                    })

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        variables_data = validated_data.pop("variables")
        objetivo_data = validated_data.pop("terminos_objetivo")
        restricciones_data = validated_data.pop("restricciones", [])

        problema = ProblemaOptimizacion.objects.create(
            **validated_data
        )

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

        return problema
