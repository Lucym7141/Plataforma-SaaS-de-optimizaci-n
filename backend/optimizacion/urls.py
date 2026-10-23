
from django.urls import path

from . import views

app_name = "optimizacion"

urlpatterns = [
    path("auth/registro/", views.registrar_usuario, name="registro_usuario"),
    path("auth/login/", views.iniciar_sesion, name="iniciar_sesion"),
    path("auth/logout/", views.cerrar_sesion, name="cerrar_sesion"),
    path("auth/me/", views.usuario_actual, name="usuario_actual"),
    path("auth/config/", views.configuracion_autenticacion, name="auth_config"),
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
