"""API de problemas de optimización."""

import json
import logging

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    UsoIA,
    EjecucionOptimizacion,
    ProblemaOptimizacion,
    OptimizationJob,
)
from ..serializers import (
    ProblemaOptimizacionSerializer,
    ProblemaOptimizacionCrearSerializer,
    ProblemaDesdeTextoSerializer,
    EjecucionOptimizacionSerializer,
)
from ..plans import (
    PlanLimitError,
    check_ai_quota,
    check_can_add,
    lock_account,
    plan_limit_response,
    record_ai_use,
)
from ..reporting import build_problem_report
from ..ai_modeling import (
    AzureOpenAIConfigurationError,
    AzureOpenAIServiceError,
    generar_modelo,
)
from ..throttles import (
    ResolverRateThrottle,
    GenerarModeloRateThrottle,
)

from .common import _execution_report_response
from .jobs import _active_job_exists, _create_optimization_job

logger = logging.getLogger(__name__)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def listar_problemas(request):
    """Lista los problemas activos o crea un problema nuevo."""

    if request.method == "POST":
        serializer = ProblemaOptimizacionCrearSerializer(
            data=request.data,
            context={"request": request},
        )

        if serializer.is_valid():
            try:
                with transaction.atomic():
                    lock_account(request.user)
                    check_can_add(request.user, "models")
                    problema = serializer.save()
            except PlanLimitError as error:
                return plan_limit_response(error)

            respuesta = ProblemaOptimizacionSerializer(problema)

            return Response(
                respuesta.data,
                status=status.HTTP_201_CREATED,
            )

        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST,
        )

    problemas = ProblemaOptimizacion.objects.filter(
        propietario=request.user,
        archivado=False,
    )
    serializer = ProblemaOptimizacionSerializer(
        problemas,
        many=True,
    )

    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([GenerarModeloRateThrottle])
def generar_problema_desde_texto(request):
    solicitud = ProblemaDesdeTextoSerializer(data=request.data)
    if not solicitud.is_valid():
        return Response(
            solicitud.errors,
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        check_ai_quota(request.user)
    except PlanLimitError as error:
        return plan_limit_response(error)

    try:
        respuesta_ia = generar_modelo(solicitud.validated_data["texto"])
    except AzureOpenAIConfigurationError as error:
        return Response(
            {"detail": str(error)},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    except AzureOpenAIServiceError:
        logger.exception("Azure OpenAI no pudo generar un modelo.")
        return Response(
            {
                "detail": (
                    "No se pudo generar el borrador con Azure OpenAI. "
                    "Verifica el despliegue y vuelve a intentarlo."
                )
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )

    try:
        modelo = json.loads(respuesta_ia)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Azure OpenAI devolvió JSON inválido para un modelo.")
        return Response(
            {
                "detail": (
                    "La respuesta de IA no tuvo un formato válido. "
                    "Reformula la descripción e inténtalo de nuevo."
                )
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )

    if not isinstance(modelo, dict):
        return Response(
            {"detail": "La IA no devolvió un objeto de modelo válido."},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    validacion = ProblemaOptimizacionCrearSerializer(data=modelo)
    if not validacion.is_valid():
        logger.warning("Azure OpenAI devolvió un borrador que no pasó validación.")
        return Response(
            {
                "detail": (
                    "El borrador de IA no cumple las validaciones del modelo. "
                    "Aclara variables, objetivo y restricciones, y vuelve a intentarlo."
                )
            },
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    record_ai_use(request.user, UsoIA.Tipo.BORRADOR)
    return Response(validacion.validated_data)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def detalle_problema(request, problema_id):
    """Devuelve un problema con sus variables y restricciones."""
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
    )
    if request.method in {"DELETE", "PUT"} and _active_job_exists(
        problem=problema,
    ):
        return Response(
            {"detail": "Espera a que termine el cálculo antes de modificar el modelo."},
            status=status.HTTP_409_CONFLICT,
        )
    if request.method == "DELETE":
        problema.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    if request.method == "PUT":
        if problema.archivado:
            return Response(
                {"detail": "No puedes editar un problema archivado."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = ProblemaOptimizacionCrearSerializer(
            problema,
            data=request.data,
            context={"request": request},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(ProblemaOptimizacionSerializer(problema).data)

    serializer = ProblemaOptimizacionSerializer(problema)

    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ResolverRateThrottle])
def resolver_problema_api(request, problema_id):
    """Encola el solucionador y devuelve la referencia al trabajo."""
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
    )

    if not problema.activo or problema.archivado:
        return Response(
            {"error": "El problema está inactivo o archivado y no puede ejecutarse."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return _create_optimization_job(
        request,
        job_type=OptimizationJob.Type.PROBLEM,
        problem=problema,
        snapshot=ProblemaOptimizacionSerializer(problema).data,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def reporte_ejecucion_problema(request, problema_id, ejecucion_id, formato):
    execution = get_object_or_404(
        EjecucionOptimizacion.objects.select_related("problema"),
        pk=ejecucion_id,
        problema_id=problema_id,
        problema__propietario=request.user,
    )
    return _execution_report_response(
        execution,
        formato,
        build_problem_report,
        execution.modelo_snapshot.get("nombre", execution.problema.nombre),
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def listar_problemas_archivados(request):
    problemas = ProblemaOptimizacion.objects.filter(
        propietario=request.user,
        archivado=True,
    )
    return Response(ProblemaOptimizacionSerializer(problemas, many=True).data)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def archivar_problema(request, problema_id):
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
        archivado=False,
    )
    if _active_job_exists(problem=problema):
        return Response(
            {
                "detail": (
                    "Espera a que termine el cálculo antes de archivar "
                    "el modelo."
                )
            },
            status=status.HTTP_409_CONFLICT,
        )
    problema.archivado = True
    problema.save(update_fields=["archivado", "actualizado_en"])
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def restaurar_problema(request, problema_id):
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
        archivado=True,
    )
    try:
        with transaction.atomic():
            lock_account(request.user)
            check_can_add(request.user, "models")
            problema.archivado = False
            problema.save(update_fields=["archivado", "actualizado_en"])
    except PlanLimitError as error:
        return plan_limit_response(error)
    return Response(ProblemaOptimizacionSerializer(problema).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def duplicar_problema(request, problema_id):
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
        archivado=False,
    )
    datos = ProblemaOptimizacionSerializer(problema).data
    datos["nombre"] = f"{problema.nombre} (copia)"[:150]
    serializer = ProblemaOptimizacionCrearSerializer(
        data=datos,
        context={"request": request},
    )
    try:
        with transaction.atomic():
            lock_account(request.user)
            check_can_add(request.user, "models")
            serializer.is_valid(raise_exception=True)
            copia = serializer.save()
    except PlanLimitError as error:
        return plan_limit_response(error)
    return Response(
        ProblemaOptimizacionSerializer(copia).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def historial_problema(request, problema_id):
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
    )
    ejecuciones = EjecucionOptimizacion.objects.filter(
        problema=problema,
    ).prefetch_related("valores")
    return Response(EjecucionOptimizacionSerializer(ejecuciones, many=True).data)
