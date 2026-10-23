
from django.core.exceptions import ValidationError
from django.db import models
from django.conf import settings


class ProblemaOptimizacion(models.Model):
    """Problema matemático que el usuario desea optimizar."""

    class TipoObjetivo(models.TextChoices):
        MAXIMIZAR = "MAX", "Maximizar"
        MINIMIZAR = "MIN", "Minimizar"

    nombre = models.CharField(max_length=150)
    descripcion = models.TextField(blank=True)
    propietario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="problemas_optimizacion",
        null=True,
        blank=True,
    )
    tipo_objetivo = models.CharField(
        max_length=3,
        choices=TipoObjetivo.choices,
        default=TipoObjetivo.MAXIMIZAR,
    )
    activo = models.BooleanField(default=True)
    archivado = models.BooleanField(default=False)
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-creado_en"]

    def __str__(self):
        return self.nombre


class VariableDecision(models.Model):
    """Variable cuyo valor debe determinar el optimizador."""

    class TipoVariable(models.TextChoices):
        CONTINUA = "CONT", "Continua"
        ENTERA = "ENT", "Entera"
        BINARIA = "BIN", "Binaria"

    problema = models.ForeignKey(
        ProblemaOptimizacion,
        on_delete=models.CASCADE,
        related_name="variables",
    )
    nombre = models.CharField(max_length=100)
    descripcion = models.TextField(blank=True)
    unidad = models.CharField(max_length=50, blank=True)
    tipo = models.CharField(
        max_length=4,
        choices=TipoVariable.choices,
        default=TipoVariable.CONTINUA,
    )
    limite_inferior = models.DecimalField(
        max_digits=20,
        decimal_places=6,
        null=True,
        blank=True,
    )
    limite_superior = models.DecimalField(
        max_digits=20,
        decimal_places=6,
        null=True,
        blank=True,
    )
    metadatos = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["problema", "nombre"],
                name="uq_variable_nombre_problema",
            ),
        ]

    def clean(self):
        super().clean()

        if (
            self.limite_inferior is not None
            and self.limite_superior is not None
            and self.limite_inferior > self.limite_superior
        ):
            raise ValidationError(
                "El límite inferior no puede superar el límite superior."
            )

        if self.tipo == self.TipoVariable.BINARIA:
            if self.limite_inferior not in (None, 0):
                raise ValidationError(
                    "Una variable binaria debe tener límite inferior 0."
                )
            if self.limite_superior not in (None, 1):
                raise ValidationError(
                    "Una variable binaria debe tener límite superior 1."
                )

    def __str__(self):
        return f"{self.nombre} ({self.problema.nombre})"


class TerminoObjetivo(models.Model):
    """Coeficiente de una variable en la función objetivo."""

    problema = models.ForeignKey(
        ProblemaOptimizacion,
        on_delete=models.CASCADE,
        related_name="terminos_objetivo",
    )
    variable = models.ForeignKey(
        VariableDecision,
        on_delete=models.CASCADE,
        related_name="terminos_objetivo",
    )
    coeficiente = models.DecimalField(
        max_digits=20,
        decimal_places=6,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["problema", "variable"],
                name="uq_objetivo_variable_problema",
            ),
        ]

    def clean(self):
        super().clean()
        if (
            self.problema_id
            and self.variable_id
            and self.problema_id != self.variable.problema_id
        ):
            raise ValidationError(
                "La variable debe pertenecer al mismo problema."
            )

    def __str__(self):
        return f"{self.coeficiente} × {self.variable.nombre}"


class Restriccion(models.Model):
    """Restricción que debe cumplir una solución."""

    class Operador(models.TextChoices):
        MENOR_IGUAL = "LE", "Menor o igual (<=)"
        MAYOR_IGUAL = "GE", "Mayor o igual (>=)"
        IGUAL = "EQ", "Igual (=)"

    problema = models.ForeignKey(
        ProblemaOptimizacion,
        on_delete=models.CASCADE,
        related_name="restricciones",
    )
    nombre = models.CharField(max_length=150)
    descripcion = models.TextField(blank=True)
    operador = models.CharField(
        max_length=2,
        choices=Operador.choices,
    )
    lado_derecho = models.DecimalField(
        max_digits=20,
        decimal_places=6,
    )

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["problema", "nombre"],
                name="uq_restriccion_nombre_problema",
            ),
        ]

    def __str__(self):
        return f"{self.nombre} ({self.problema.nombre})"


class TerminoRestriccion(models.Model):
    """Coeficiente de una variable dentro de una restricción."""

    restriccion = models.ForeignKey(
        Restriccion,
        on_delete=models.CASCADE,
        related_name="terminos",
    )
    variable = models.ForeignKey(
        VariableDecision,
        on_delete=models.CASCADE,
        related_name="terminos_restriccion",
    )
    coeficiente = models.DecimalField(
        max_digits=20,
        decimal_places=6,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["restriccion", "variable"],
                name="uq_termino_variable_restriccion",
            ),
        ]

    def clean(self):
        super().clean()
        if (
            self.restriccion_id
            and self.variable_id
            and self.restriccion.problema_id != self.variable.problema_id
        ):
            raise ValidationError(
                "La variable debe pertenecer al problema de la restricción."
            )

    def __str__(self):
        return f"{self.coeficiente} × {self.variable.nombre}"


class EjecucionOptimizacion(models.Model):
    """Registro de cada intento de resolver un problema."""

    class Estado(models.TextChoices):
        PENDIENTE = "PEND", "Pendiente"
        OPTIMO = "OPT", "Óptimo"
        INFACTIBLE = "INF", "Infactible"
        NO_ACOTADO = "UNB", "No acotado"
        LIMITE_TIEMPO = "TIME", "Límite de tiempo"
        ERROR = "ERR", "Error"

    problema = models.ForeignKey(
        ProblemaOptimizacion,
        on_delete=models.CASCADE,
        related_name="ejecuciones",
    )
    estado = models.CharField(
        max_length=4,
        choices=Estado.choices,
        default=Estado.PENDIENTE,
    )
    solucionador = models.CharField(max_length=100, default="PuLP")
    valor_objetivo = models.DecimalField(
        max_digits=24,
        decimal_places=6,
        null=True,
        blank=True,
    )
    mensaje = models.TextField(blank=True)
    detalles = models.JSONField(default=dict, blank=True)
    modelo_snapshot = models.JSONField(default=dict, blank=True)
    iniciada_en = models.DateTimeField(auto_now_add=True)
    finalizada_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-iniciada_en"]

    def __str__(self):
        return f"Ejecución {self.pk} - {self.problema.nombre}"


class ValorSolucion(models.Model):
    """Valor encontrado para cada variable en una ejecución."""

    ejecucion = models.ForeignKey(
        EjecucionOptimizacion,
        on_delete=models.CASCADE,
        related_name="valores",
    )
    variable = models.ForeignKey(
        VariableDecision,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="valores_solucion",
    )
    variable_nombre = models.CharField(max_length=100, default="")
    valor = models.DecimalField(
        max_digits=24,
        decimal_places=6,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["ejecucion", "variable"],
                name="uq_valor_variable_ejecucion",
            ),
        ]

    def clean(self):
        super().clean()
        if (
            self.ejecucion_id
            and self.variable_id
            and self.ejecucion.problema_id != self.variable.problema_id
        ):
            raise ValidationError(
                "La variable debe pertenecer al problema ejecutado."
            )

    def __str__(self):
        return f"{self.variable_nombre} = {self.valor}"


class VerificacionCorreo(models.Model):
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="verificacion_correo",
    )
    verificado_en = models.DateTimeField(null=True, blank=True)


class OptimizacionPortafolio(models.Model):
    propietario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="optimizaciones_portafolio",
    )
    nombre = models.CharField(max_length=150)
    activos = models.JSONField()
    categorias = models.JSONField(default=list, blank=True)
    rendimientos_esperados = models.JSONField()
    covarianza = models.JSONField()
    aversion_riesgo = models.DecimalField(max_digits=12, decimal_places=6)
    periodos_por_anio = models.PositiveSmallIntegerField(default=1)
    pesos_minimos = models.JSONField(default=list, blank=True)
    pesos_maximos = models.JSONField(default=list, blank=True)
    limites_categoria = models.JSONField(default=dict, blank=True)
    escenarios_estres = models.JSONField(default=dict, blank=True)
    archivado = models.BooleanField(default=False)
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-actualizado_en"]

    def __str__(self):
        return self.nombre


class EjecucionPortafolio(models.Model):
    optimizacion = models.ForeignKey(
        OptimizacionPortafolio,
        on_delete=models.CASCADE,
        related_name="ejecuciones",
    )
    modelo_snapshot = models.JSONField(default=dict)
    estado = models.CharField(max_length=20, default="OPT")
    rendimientos_portafolio = models.FloatField()
    varianza_portafolio = models.FloatField()
    volatilidad_portafolio = models.FloatField()
    utilidad_riesgo = models.FloatField()
    ponderaciones = models.JSONField()
    contribuciones_riesgo = models.JSONField(default=list)
    rendimiento_anualizado = models.FloatField(null=True, blank=True)
    volatilidad_anualizada = models.FloatField(null=True, blank=True)
    resultados_estres = models.JSONField(default=dict)
    creada_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-creada_en"]


class RateLimitCounter(models.Model):
    """Contador de solicitudes por identidad y ventana temporal."""

    key = models.CharField(max_length=64, unique=True)
    count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(db_index=True)
