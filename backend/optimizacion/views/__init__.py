"""Vistas de la app, divididas por área.

Este paquete reexporta todas las vistas para que `urls.py` siga usando
`views.<nombre>`.
"""
from .auth import (  # noqa: F401
    registrar_usuario,
    iniciar_sesion,
    verificar_correo,
    reenviar_verificacion,
    solicitar_restablecimiento,
    confirmar_restablecimiento,
    usuario_actual,
    configuracion_autenticacion,
    cerrar_sesion,
)
from .account import (  # noqa: F401
    perfil_usuario,
    foto_perfil_usuario,
    exportar_datos_usuario,
    eliminar_cuenta,
    cambiar_contrasena,
    resumen_usuario,
)
from .problems import (  # noqa: F401
    listar_problemas,
    generar_problema_desde_texto,
    detalle_problema,
    resolver_problema_api,
    reporte_ejecucion_problema,
    listar_problemas_archivados,
    archivar_problema,
    restaurar_problema,
    duplicar_problema,
    historial_problema,
)
from .portfolios import (  # noqa: F401
    listar_portafolios,
    previsualizar_importacion_portafolio,
    detalle_portafolio,
    duplicar_portafolio,
    historial_portafolio,
    reporte_ejecucion_portafolio,
    resolver_portafolio,
    frontera_portafolio,
    portafolios_archivados,
    restaurar_portafolio,
)
from .jobs import (  # noqa: F401
    detalle_trabajo_optimizacion,
    listar_trabajos_optimizacion,
)
from .pages import (  # noqa: F401
    listar_planes,
    inicio,
    pagina_planes,
)
from .explanations import (  # noqa: F401
    explicar_ejecucion_portafolio,
    explicar_ejecucion_problema,
)
