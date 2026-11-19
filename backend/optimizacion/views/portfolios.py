"""API de portafolios de inversión."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import (
    api_view,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    EjecucionPortafolio,
    OptimizacionPortafolio,
    OptimizationJob,
)
from ..serializers import (
    DatosPortafolioSerializer,
    OptimizacionPortafolioSerializer,
    EjecucionPortafolioSerializer,
)
from ..plans import (
    PlanLimitError,
    check_asset_count,
    check_can_add,
    lock_account,
    plan_limit_response,
)
from ..portfolio_import import preview_portfolio_csv
from ..reporting import build_portfolio_report
from ..throttles import (
    ResolverRateThrottle,
)

from .common import _execution_report_response
from .jobs import _active_job_exists, _create_optimization_job


def _portfolio_values(validated_data):
    values = dict(validated_data)
    values["rendimientos_esperados"] = [
        str(value) for value in values["rendimientos_esperados"]
    ]
    values["covarianza"] = [
        [str(value) for value in row]
        for row in values["covarianza"]
    ]
    values["pesos_minimos"] = [
        str(value) for value in values["pesos_minimos"]
    ]
    values["pesos_maximos"] = [
        str(value) for value in values["pesos_maximos"]
    ]
    values["limites_categoria"] = {
        name: str(value)
        for name, value in values["limites_categoria"].items()
    }
    values["escenarios_estres"] = {
        name: [str(value) for value in returns]
        for name, returns in values["escenarios_estres"].items()
    }
    return values


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def listar_portafolios(request):
    if request.method == "GET":
        items = OptimizacionPortafolio.objects.filter(
            propietario=request.user,
            archivado=False,
        )
        return Response(
            OptimizacionPortafolioSerializer(items, many=True).data
        )

    serializer = DatosPortafolioSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        with transaction.atomic():
            lock_account(request.user)
            check_can_add(request.user, "portfolios")
            check_asset_count(
                request.user, len(serializer.validated_data["activos"])
            )
            item = OptimizacionPortafolio.objects.create(
                propietario=request.user,
                **_portfolio_values(serializer.validated_data),
            )
    except PlanLimitError as error:
        return plan_limit_response(error)
    return Response(
        OptimizacionPortafolioSerializer(item).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def previsualizar_importacion_portafolio(request):
    uploaded_file = request.FILES.get("archivo")
    if uploaded_file is None:
        return Response(
            {"archivo": ["Adjunta un archivo CSV para importar."]},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        preview = preview_portfolio_csv(
            uploaded_file,
            request.data.get("nombre", ""),
        )
    except serializers.ValidationError as error:
        return Response(error.detail, status=status.HTTP_400_BAD_REQUEST)
    try:
        check_asset_count(request.user, len(preview["activos"]))
    except PlanLimitError as error:
        return plan_limit_response(error)
    return Response({"preview": preview})


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def detalle_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
    )
    if request.method == "GET":
        return Response(OptimizacionPortafolioSerializer(item).data)
    if _active_job_exists(portfolio=item):
        return Response(
            {"detail": "Espera a que termine el cálculo antes de modificar el portafolio."},
            status=status.HTTP_409_CONFLICT,
        )
    if request.method == "DELETE":
        item.archivado = True
        item.save(update_fields=["archivado", "actualizado_en"])
        return Response(status=status.HTTP_204_NO_CONTENT)
    if item.archivado:
        return Response(
            {"detail": "No puedes editar un portafolio archivado."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = DatosPortafolioSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        check_asset_count(request.user, len(serializer.validated_data["activos"]))
    except PlanLimitError as error:
        return plan_limit_response(error)
    for field, value in _portfolio_values(serializer.validated_data).items():
        setattr(item, field, value)
    item.save()
    return Response(OptimizacionPortafolioSerializer(item).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def duplicar_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
        archivado=False,
    )
    try:
        with transaction.atomic():
            lock_account(request.user)
            check_can_add(request.user, "portfolios")
            check_asset_count(request.user, len(item.activos))
            copia = _duplicate_portfolio(request.user, item)
    except PlanLimitError as error:
        return plan_limit_response(error)
    return Response(
        OptimizacionPortafolioSerializer(copia).data,
        status=status.HTTP_201_CREATED,
    )


def _duplicate_portfolio(owner, item):
    return OptimizacionPortafolio.objects.create(
        propietario=owner,
        nombre=f"{item.nombre} (copia)"[:150],
        activos=item.activos,
        rendimientos_esperados=item.rendimientos_esperados,
        covarianza=item.covarianza,
        aversion_riesgo=item.aversion_riesgo,
        periodos_por_anio=item.periodos_por_anio,
        categorias=item.categorias or [""] * len(item.activos),
        pesos_minimos=item.pesos_minimos or ["0"] * len(item.activos),
        pesos_maximos=item.pesos_maximos or ["1"] * len(item.activos),
        limites_categoria=item.limites_categoria,
        escenarios_estres=item.escenarios_estres,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def historial_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
    )
    ejecuciones = item.ejecuciones.all()
    return Response(
        EjecucionPortafolioSerializer(ejecuciones, many=True).data
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def reporte_ejecucion_portafolio(request, portafolio_id, ejecucion_id, formato):
    execution = get_object_or_404(
        EjecucionPortafolio.objects.select_related("optimizacion"),
        pk=ejecucion_id,
        optimizacion_id=portafolio_id,
        optimizacion__propietario=request.user,
    )
    return _execution_report_response(
        execution,
        formato,
        build_portfolio_report,
        execution.modelo_snapshot.get("nombre", execution.optimizacion.nombre),
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ResolverRateThrottle])
def resolver_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
        archivado=False,
    )
    return _create_optimization_job(
        request,
        job_type=OptimizationJob.Type.PORTFOLIO,
        portfolio=item,
        snapshot=OptimizacionPortafolioSerializer(item).data,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ResolverRateThrottle])
def frontera_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
        archivado=False,
    )
    return _create_optimization_job(
        request,
        job_type=OptimizationJob.Type.FRONTIER,
        portfolio=item,
        snapshot=OptimizacionPortafolioSerializer(item).data,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portafolios_archivados(request):
    items = OptimizacionPortafolio.objects.filter(
        propietario=request.user,
        archivado=True,
    )
    return Response(OptimizacionPortafolioSerializer(items, many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def restaurar_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
        archivado=True,
    )
    try:
        with transaction.atomic():
            lock_account(request.user)
            check_can_add(request.user, "portfolios")
            check_asset_count(request.user, len(item.activos))
            item.archivado = False
            item.save(update_fields=["archivado", "actualizado_en"])
    except PlanLimitError as error:
        return plan_limit_response(error)
    return Response(OptimizacionPortafolioSerializer(item).data)
