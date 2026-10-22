
from django.urls import path

from . import views

app_name = "optimizacion"

urlpatterns = [
    path(
        "problemas/",
        views.listar_problemas,
        name="listar_problemas",
    ),
    path(
        "problemas/<int:problema_id>/",
        views.detalle_problema,
        name="detalle_problema",
    ),
    path(
        "problemas/<int:problema_id>/resolver/",
        views.resolver_problema_api,
        name="resolver_problema",
    ),
]
