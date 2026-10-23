
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.shortcuts import render

from .models import ProblemaOptimizacion, EjecucionOptimizacion
from .serializers import (
    ProblemaOptimizacionSerializer,
    EjecucionOptimizacionSerializer,
)
from .services import resolver_problema


@api_view(["GET"])
def listar_problemas(request):
    """Devuelve la lista de problemas de optimización."""
    problemas = ProblemaOptimizacion.objects.filter(activo=True)
    serializer = ProblemaOptimizacionSerializer(problemas, many=True)

    return Response(serializer.data)


@api_view(["GET"])
def detalle_problema(request, problema_id):
    """Devuelve un problema con sus variables y restricciones."""
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
    )
    serializer = ProblemaOptimizacionSerializer(problema)

    return Response(serializer.data)


@api_view(["POST"])
def resolver_problema_api(request, problema_id):
    """Ejecuta el solucionador y devuelve el resultado."""
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
    )

    if not problema.activo:
        return Response(
            {"error": "El problema está inactivo y no puede ejecutarse."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    ejecucion = resolver_problema(problema.id)

    serializer = EjecucionOptimizacionSerializer(ejecucion)

    if ejecucion.estado == EjecucionOptimizacion.Estado.ERROR:
        return Response(
            serializer.data,
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response(
        serializer.data,
        status=status.HTTP_200_OK,
    )

def inicio(request):
    return render(request, "index.html")
