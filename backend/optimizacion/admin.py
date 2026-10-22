
from django.contrib import admin

from .models import (
    ProblemaOptimizacion,
    VariableDecision,
    TerminoObjetivo,
    Restriccion,
    TerminoRestriccion,
    EjecucionOptimizacion,
    ValorSolucion,
)


class VariableDecisionInline(admin.TabularInline):
    model = VariableDecision
    extra = 1


class TerminoObjetivoInline(admin.TabularInline):
    model = TerminoObjetivo
    extra = 1


class RestriccionInline(admin.TabularInline):
    model = Restriccion
    extra = 1


class TerminoRestriccionInline(admin.TabularInline):
    model = TerminoRestriccion
    extra = 1


class ValorSolucionInline(admin.TabularInline):
    model = ValorSolucion
    extra = 1


@admin.register(ProblemaOptimizacion)
class ProblemaOptimizacionAdmin(admin.ModelAdmin):
    list_display = (
        "nombre",
        "tipo_objetivo",
        "activo",
        "creado_en",
    )
    list_filter = ("tipo_objetivo", "activo")
    search_fields = ("nombre", "descripcion")
    inlines = [
        VariableDecisionInline,
        TerminoObjetivoInline,
        RestriccionInline,
    ]


@admin.register(VariableDecision)
class VariableDecisionAdmin(admin.ModelAdmin):
    list_display = (
        "nombre",
        "problema",
        "tipo",
        "limite_inferior",
        "limite_superior",
    )
    list_filter = ("tipo",)
    search_fields = ("nombre", "problema__nombre")


@admin.register(TerminoObjetivo)
class TerminoObjetivoAdmin(admin.ModelAdmin):
    list_display = ("problema", "variable", "coeficiente")


@admin.register(Restriccion)
class RestriccionAdmin(admin.ModelAdmin):
    list_display = ("nombre", "problema", "operador", "lado_derecho")
    list_filter = ("operador",)
    inlines = [TerminoRestriccionInline]


@admin.register(TerminoRestriccion)
class TerminoRestriccionAdmin(admin.ModelAdmin):
    list_display = ("restriccion", "variable", "coeficiente")


@admin.register(EjecucionOptimizacion)
class EjecucionOptimizacionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "problema",
        "estado",
        "solucionador",
        "valor_objetivo",
        "iniciada_en",
    )
    list_filter = ("estado", "solucionador")
    search_fields = ("problema__nombre", "mensaje")
    inlines = [ValorSolucionInline]


@admin.register(ValorSolucion)
class ValorSolucionAdmin(admin.ModelAdmin):
    list_display = ("ejecucion", "variable", "valor")
