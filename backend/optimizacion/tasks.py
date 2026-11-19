import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import (
    EjecucionOptimizacion,
    EjecucionPortafolio,
    OptimizationJob,
)
from .portfolio import (
    calcular_frontera_eficiente,
    optimizar_media_varianza,
)
from .serializers import (
    EjecucionOptimizacionSerializer,
    EjecucionPortafolioSerializer,
)
from .services import resolver_problema

logger = logging.getLogger(__name__)


def _portfolio_solver_inputs(snapshot):
    count = len(snapshot["activos"])
    minimums = snapshot.get("pesos_minimos") or [0] * count
    maximums = snapshot.get("pesos_maximos") or [1] * count
    return {
        "bounds": [
            (float(minimum), float(maximum))
            for minimum, maximum in zip(minimums, maximums)
        ],
        "categorias": snapshot.get("categorias") or [""] * count,
        "limites_categoria": {
            name: float(value)
            for name, value in snapshot.get("limites_categoria", {}).items()
        },
    }


def _run_job(job):
    if job.job_type == OptimizationJob.Type.PROBLEM:
        execution = resolver_problema(job.problem_id)
        if execution.estado == EjecucionOptimizacion.Estado.ERROR:
            raise ValueError("El solucionador no pudo completar el modelo.")
        return EjecucionOptimizacionSerializer(execution).data

    snapshot = job.input_snapshot
    if job.job_type == OptimizationJob.Type.PORTFOLIO:
        result = optimizar_media_varianza(
            [float(value) for value in snapshot["rendimientos_esperados"]],
            [
                [float(value) for value in row]
                for row in snapshot["covarianza"]
            ],
            float(snapshot["aversion_riesgo"]),
            **_portfolio_solver_inputs(snapshot),
            periodos_por_anio=snapshot["periodos_por_anio"],
            escenarios_estres={
                name: [float(value) for value in returns]
                for name, returns in snapshot["escenarios_estres"].items()
            },
        )
        execution = EjecucionPortafolio.objects.create(
            optimizacion=job.portfolio,
            modelo_snapshot=snapshot,
            **result,
        )
        return EjecucionPortafolioSerializer(execution).data

    if job.job_type == OptimizationJob.Type.FRONTIER:
        points = calcular_frontera_eficiente(
            [float(value) for value in snapshot["rendimientos_esperados"]],
            [
                [float(value) for value in row]
                for row in snapshot["covarianza"]
            ],
            **_portfolio_solver_inputs(snapshot),
        )
        return {"activos": snapshot["activos"], "puntos": points}

    raise ValueError("Tipo de trabajo de optimización desconocido.")


INTERRUPTED_ERROR = (
    "El cálculo se interrumpió antes de terminar. Inténtalo de nuevo."
)
FAILED_ERROR = (
    "No se pudo completar el cálculo. Revisa el modelo e inténtalo de nuevo."
)


def _stale_running_cutoff():
    # Pasado el límite duro de Celery, un trabajo en proceso ya no puede
    # seguir vivo: el worker lo habría terminado.
    limit = getattr(settings, "CELERY_TASK_TIME_LIMIT", 900) or 900
    return timezone.now() - timedelta(seconds=int(limit) + 60)


def expire_stale_jobs(**filters):
    """Marca como fallidos los trabajos que quedaron en proceso tras una caída."""
    return OptimizationJob.objects.filter(
        status=OptimizationJob.Status.RUNNING,
        started_at__lt=_stale_running_cutoff(),
        **filters,
    ).update(
        status=OptimizationJob.Status.FAILED,
        error=INTERRUPTED_ERROR,
        completed_at=timezone.now(),
    )


def _finish_job(job_id, **fields):
    # Solo un trabajo que sigue en proceso puede cerrarse; así una entrega
    # repetida no sobrescribe un resultado ya guardado.
    return OptimizationJob.objects.filter(
        pk=job_id,
        status=OptimizationJob.Status.RUNNING,
    ).update(completed_at=timezone.now(), **fields)


@shared_task(
    name="optimizacion.run_optimization_job",
    acks_late=True,
    reject_on_worker_lost=True,
    soft_time_limit=840,
    time_limit=900,
)
def run_optimization_job(job_id):
    claimed = OptimizationJob.objects.filter(
        pk=job_id,
        status=OptimizationJob.Status.QUEUED,
    ).update(
        status=OptimizationJob.Status.RUNNING,
        started_at=timezone.now(),
    )
    if not claimed:
        # Una entrega repetida de un trabajo que ya estaba en proceso indica
        # que el worker anterior murió a mitad del cálculo. No se vuelve a
        # ejecutar para no duplicar resultados; se marca como interrumpido.
        interrupted = _finish_job(
            job_id,
            status=OptimizationJob.Status.FAILED,
            error=INTERRUPTED_ERROR,
        )
        if interrupted:
            logger.warning(
                "El trabajo de optimización %s se reentregó tras una "
                "interrupción y se marcó como fallido.",
                job_id,
            )
        return

    job = OptimizationJob.objects.select_related(
        "problem",
        "portfolio",
    ).get(pk=job_id)

    try:
        result = _run_job(job)
    except Exception:
        logger.exception("El trabajo de optimización %s falló.", job.pk)
        _finish_job(
            job.pk,
            status=OptimizationJob.Status.FAILED,
            error=FAILED_ERROR,
        )
        return

    _finish_job(
        job.pk,
        status=OptimizationJob.Status.COMPLETED,
        result=result,
        error="",
    )
