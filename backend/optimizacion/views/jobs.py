"""Encolado y consulta de trabajos de optimización."""

import json
import logging

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    permission_classes,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from kombu.exceptions import OperationalError

from ..models import (
    OptimizationJob,
)
from ..tasks import expire_stale_jobs, run_optimization_job

logger = logging.getLogger(__name__)


def _active_job_exists(**filters):
    expire_stale_jobs(**filters)
    return OptimizationJob.objects.filter(
        status__in=[
            OptimizationJob.Status.QUEUED,
            OptimizationJob.Status.RUNNING,
        ],
        **filters,
    ).exists()


def _create_optimization_job(
    request,
    *,
    job_type,
    snapshot,
    problem=None,
    portfolio=None,
):
    target_model = type(problem) if problem is not None else type(portfolio)
    target = problem if problem is not None else portfolio
    target_filter = (
        {"problem": problem} if problem is not None else {"portfolio": portfolio}
    )
    with transaction.atomic():
        # Bloquea el modelo para que dos solicitudes simultáneas no encolen
        # dos cálculos sobre el mismo problema o portafolio.
        target_model.objects.select_for_update().get(pk=target.pk)
        if _active_job_exists(**target_filter):
            return Response(
                {
                    "detail": (
                        "Ya hay un cálculo en curso para este modelo. "
                        "Espera a que termine."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        job = OptimizationJob.objects.create(
            owner=request.user,
            problem=problem,
            portfolio=portfolio,
            job_type=job_type,
            input_snapshot=json.loads(
                json.dumps(snapshot, cls=DjangoJSONEncoder)
            ),
        )
    try:
        task = run_optimization_job.delay(str(job.pk))
    except OperationalError:
        logger.exception("No se pudo enviar el trabajo %s a Celery.", job.pk)
        job.status = OptimizationJob.Status.FAILED
        job.error = (
            "El servicio de cálculos no está disponible. "
            "Inicia Redis y el worker de Celery."
        )
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "error", "completed_at"])
        return Response(
            {"detail": job.error},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    job.celery_task_id = task.id
    job.save(update_fields=["celery_task_id"])
    job.refresh_from_db(fields=["status"])
    status_url = reverse(
        "optimizacion:optimization_job_detail",
        kwargs={"job_id": job.pk},
    )
    return Response(
        {
            "id": str(job.pk),
            "status": job.status,
            "status_url": status_url,
        },
        status=status.HTTP_202_ACCEPTED,
        headers={"Location": status_url},
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def detalle_trabajo_optimizacion(request, job_id):
    job = get_object_or_404(
        OptimizationJob,
        pk=job_id,
        owner=request.user,
    )
    return Response(
        {
            "id": str(job.pk),
            "type": job.job_type,
            "status": job.status,
            "error": job.error or None,
            "created_at": job.created_at,
            "started_at": job.started_at,
            "completed_at": job.completed_at,
            "result": job.result,
        }
    )
