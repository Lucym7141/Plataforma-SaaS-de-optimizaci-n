
from rest_framework import serializers

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
