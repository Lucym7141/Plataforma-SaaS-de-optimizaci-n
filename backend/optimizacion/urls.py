
from django.urls import path

from . import views

app_name = "optimizacion"

urlpatterns = [
    path("auth/registro/", views.registrar_usuario, name="registro_usuario"),
    path("auth/login/", views.iniciar_sesion, name="iniciar_sesion"),
    path("auth/logout/", views.cerrar_sesion, name="cerrar_sesion"),
    path("auth/me/", views.usuario_actual, name="usuario_actual"),
    path("auth/export/", views.exportar_datos_usuario, name="exportar_datos"),
    path("auth/delete/", views.eliminar_cuenta, name="eliminar_cuenta"),
    path("auth/change-password/", views.cambiar_contrasena, name="cambiar_contrasena"),
    path("auth/config/", views.configuracion_autenticacion, name="auth_config"),
    path("auth/verify/", views.verificar_correo, name="verificar_correo"),
    path(
        "auth/verify/resend/",
        views.reenviar_verificacion,
        name="reenviar_verificacion",
    ),
    path(
        "auth/password-reset/",
        views.solicitar_restablecimiento,
        name="solicitar_restablecimiento",
    ),
    path(
        "auth/password-reset/confirm/",
        views.confirmar_restablecimiento,
        name="confirmar_restablecimiento",
    ),
    path(
        "problemas/archivados/",
        views.listar_problemas_archivados,
        name="listar_problemas_archivados",
    ),
    path(
        "problemas/",
        views.listar_problemas,
        name="listar_problemas",
    ),
    path(
        "problemas/<int:problema_id>/duplicar/",
        views.duplicar_problema,
        name="duplicar_problema",
    ),
    path(
        "problemas/<int:problema_id>/historial/",
        views.historial_problema,
        name="historial_problema",
    ),
    path(
        "problemas/<int:problema_id>/restaurar/",
        views.restaurar_problema,
        name="restaurar_problema",
    ),
    path(
        "problemas/<int:problema_id>/archivar/",
        views.archivar_problema,
        name="archivar_problema",
    ),
    path(
        "problemas/<int:problema_id>/",
        views.detalle_problema,
        name="detalle_problema",
    ),
    path(
        "portafolios/archivados/",
        views.portafolios_archivados,
        name="portafolios_archivados",
    ),
    path(
        "portafolios/<int:portafolio_id>/restaurar/",
        views.restaurar_portafolio,
        name="restaurar_portafolio",
    ),
    path(
        "portafolios/",
        views.listar_portafolios,
        name="listar_portafolios",
    ),
    path(
        "portafolios/importar/preview/",
        views.previsualizar_importacion_portafolio,
        name="previsualizar_importacion_portafolio",
    ),
    path(
        "portafolios/<int:portafolio_id>/duplicar/",
        views.duplicar_portafolio,
        name="duplicar_portafolio",
    ),
    path(
        "portafolios/<int:portafolio_id>/historial/",
        views.historial_portafolio,
        name="historial_portafolio",
    ),
    path(
        "portafolios/<int:portafolio_id>/resolver/",
        views.resolver_portafolio,
        name="resolver_portafolio",
    ),
    path(
        "portafolios/<int:portafolio_id>/frontera/",
        views.frontera_portafolio,
        name="frontera_portafolio",
    ),
    path(
        "portafolios/<int:portafolio_id>/",
        views.detalle_portafolio,
        name="detalle_portafolio",
    ),
    path(
        "problemas/<int:problema_id>/resolver/",
        views.resolver_problema_api,
        name="resolver_problema",
    ),
]
