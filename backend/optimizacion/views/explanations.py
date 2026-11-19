"""Explicación con IA de los resultados de modelos y portafolios."""

import logging

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..ai_modeling import (
    AzureOpenAIConfigurationError,
    AzureOpenAIServiceError,
    explicar_resultado,
)
from ..explanations import EXPLICABLES, hechos_portafolio, hechos_problema
from ..models import EjecucionOptimizacion, EjecucionPortafolio, UsoIA
from ..plans import PlanLimitError, check_ai_quota, plan_limit_response, record_ai_use
from ..throttles import GenerarModeloRateThrottle

logger = logging.getLogger(__name__)


def _explain(request, ejecucion, build_facts):
    # Una explicación ya generada se devuelve sin volver a consultar ni cobrar.
    if ejecucion.explicacion_ia:
        return Response(ejecucion.explicacion_ia)

    try:
        check_ai_quota(request.user)
    except PlanLimitError as error:
        return plan_limit_response(error)

    throttle = GenerarModeloRateThrottle()
    if not throttle.allow_request(request, None):
        return Response(
            {
                "detail": (
                    "Hiciste muchas consultas de IA seguidas. Espera unos "
                    "minutos y vuelve a intentarlo."
                )
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    try:
        explicacion = explicar_resultado(build_facts(ejecucion))
    except AzureOpenAIConfigurationError as error:
        return Response(
            {"detail": str(error)},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    except AzureOpenAIServiceError:
        logger.exception("Azure OpenAI no pudo explicar la ejecución %s.", ejecucion.pk)
        return Response(
            {
                "detail": (
                    "No se pudo generar la explicación con IA. Vuelve a "
                    "intentarlo en unos minutos."
                )
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )

    ejecucion.explicacion_ia = explicacion
    ejecucion.save(update_fields=["explicacion_ia"])
    record_ai_use(request.user, UsoIA.Tipo.EXPLICACION)
    return Response(explicacion)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def explicar_ejecucion_problema(request, problema_id, ejecucion_id):
    ejecucion = get_object_or_404(
        EjecucionOptimizacion.objects.select_related("problema"),
        pk=ejecucion_id,
        problema_id=problema_id,
        problema__propietario=request.user,
    )
    if ejecucion.estado not in EXPLICABLES:
        return Response(
            {"detail": "Esta ejecución no tiene un resultado que explicar."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return _explain(request, ejecucion, hechos_problema)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def explicar_ejecucion_portafolio(request, portafolio_id, ejecucion_id):
    ejecucion = get_object_or_404(
        EjecucionPortafolio,
        pk=ejecucion_id,
        optimizacion_id=portafolio_id,
        optimizacion__propietario=request.user,
    )
    return _explain(request, ejecucion, hechos_portafolio)
