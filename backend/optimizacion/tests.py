
import json
from unittest.mock import patch

import pulp
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from rest_framework.test import APIClient
from django.core import signing

from .serializers import ProblemaOptimizacionCrearSerializer
from .services import resolver_problema
from .portfolio import (
    calcular_frontera_eficiente,
    optimizar_media_varianza,
)
from .models import (
    ProblemaOptimizacion,
    OptimizacionPortafolio,
    EjecucionPortafolio,
    VariableDecision,
    TerminoObjetivo,
    Restriccion,
    TerminoRestriccion,
)


class ApiOptimizacionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="inversionista",
            password="Fuerte-contraseña-739!",
        )
        self.client.force_authenticate(user=self.user)

        self.problema = ProblemaOptimizacion.objects.create(
            nombre="Problema de prueba API",
            descripcion="Prueba automatizada",
            tipo_objetivo="MAX",
            activo=True,
            propietario=self.user,
        )

        self.x = VariableDecision.objects.create(
            problema=self.problema,
            nombre="x",
            tipo="CONT",
            limite_inferior=0,
        )

        self.y = VariableDecision.objects.create(
            problema=self.problema,
            nombre="y",
            tipo="CONT",
            limite_inferior=0,
        )

        TerminoObjetivo.objects.create(
            problema=self.problema,
            variable=self.x,
            coeficiente=3,
        )

        TerminoObjetivo.objects.create(
            problema=self.problema,
            variable=self.y,
            coeficiente=5,
        )

        capacidad = Restriccion.objects.create(
            problema=self.problema,
            nombre="capacidad",
            operador="LE",
            lado_derecho=12,
        )

        TerminoRestriccion.objects.create(
            restriccion=capacidad,
            variable=self.x,
            coeficiente=2,
        )

        TerminoRestriccion.objects.create(
            restriccion=capacidad,
            variable=self.y,
            coeficiente=3,
        )

        limite_x = Restriccion.objects.create(
            problema=self.problema,
            nombre="limite_x",
            operador="LE",
            lado_derecho=4,
        )

        TerminoRestriccion.objects.create(
            restriccion=limite_x,
            variable=self.x,
            coeficiente=1,
        )

        limite_y = Restriccion.objects.create(
            problema=self.problema,
            nombre="limite_y",
            operador="LE",
            lado_derecho=3,
        )

        TerminoRestriccion.objects.create(
            restriccion=limite_y,
            variable=self.y,
            coeficiente=1,
        )

    def test_listar_problemas(self):
        respuesta = self.client.get("/api/problemas/")

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(len(respuesta.data), 1)
        self.assertEqual(
            respuesta.data[0]["nombre"],
            "Problema de prueba API",
        )

    def test_api_requiere_autenticacion(self):
        respuesta = APIClient().get("/api/problemas/")

        self.assertEqual(respuesta.status_code, 403)

    def test_usuario_no_puede_ver_problemas_ajenos(self):
        otro_usuario = get_user_model().objects.create_user(
            username="otro",
            password="Fuerte-contraseña-739!",
        )
        problema_ajeno = ProblemaOptimizacion.objects.create(
            nombre="Privado de otra cuenta",
            tipo_objetivo="MAX",
            propietario=otro_usuario,
        )

        lista = self.client.get("/api/problemas/")
        detalle = self.client.get(
            f"/api/problemas/{problema_ajeno.pk}/"
        )
        resolver = self.client.post(
            f"/api/problemas/{problema_ajeno.pk}/resolver/"
        )

        self.assertEqual(len(lista.data), 1)
        self.assertEqual(detalle.status_code, 404)
        self.assertEqual(resolver.status_code, 404)

    def test_detalle_problema(self):
        respuesta = self.client.get(
            f"/api/problemas/{self.problema.id}/"
        )

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(
            respuesta.data["variables"].__len__(),
            2,
        )
        self.assertEqual(
            respuesta.data["restricciones"].__len__(),
            3,
        )

    def test_editar_archivar_duplicar_y_conservar_historial(self):
        solution = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )
        self.assertEqual(solution.status_code, 200)

        payload = {
            "nombre": "Problema actualizado",
            "descripcion": "Descripción nueva",
            "tipo_objetivo": "MAX",
            "variables": [
                {"nombre": "x", "tipo": "CONT", "limite_inferior": "0"},
                {"nombre": "y", "tipo": "CONT", "limite_inferior": "0"},
            ],
            "terminos_objetivo": [
                {"variable_nombre": "x", "coeficiente": "3"},
                {"variable_nombre": "y", "coeficiente": "5"},
            ],
            "restricciones": [],
        }
        update = self.client.put(
            f"/api/problemas/{self.problema.pk}/",
            payload,
            format="json",
        )
        history = self.client.get(
            f"/api/problemas/{self.problema.pk}/historial/"
        )
        old_value = history.data[0]["valores"][0]
        duplicate = self.client.post(
            f"/api/problemas/{self.problema.pk}/duplicar/"
        )
        archive = self.client.delete(
            f"/api/problemas/{self.problema.pk}/archivar/"
        )

        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.data["nombre"], "Problema actualizado")
        self.assertEqual(old_value["variable_nombre"], "x")
        self.assertIsNone(old_value["variable"])
        self.assertEqual(duplicate.status_code, 201)
        self.assertEqual(duplicate.data["nombre"], "Problema actualizado (copia)")
        self.assertEqual(archive.status_code, 204)
        self.assertEqual(
            self.client.get("/api/problemas/").data,
            [duplicate.data],
        )

    def test_resolver_problema(self):
        respuesta = self.client.post(
            f"/api/problemas/{self.problema.id}/resolver/"
        )

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.data["estado"], "OPT")
        self.assertAlmostEqual(
            float(respuesta.data["valor_objetivo"]),
            19.5,
            places=4,
        )

    @patch(
        "optimizacion.services.pulp.COIN_CMD",
        wraps=pulp.COIN_CMD,
    )
    def test_solucionador_recibe_limite_de_tiempo_y_un_hilo(self, coin_cmd):
        respuesta = self.client.post(
            f"/api/problemas/{self.problema.id}/resolver/"
        )

        self.assertEqual(respuesta.status_code, 200)
        coin_cmd.assert_called_once_with(
            msg=False,
            timeLimit=30,
            threads=1,
        )

    def test_no_resolver_problema_inactivo(self):
        self.problema.activo = False
        self.problema.save()

        respuesta = self.client.post(
            f"/api/problemas/{self.problema.id}/resolver/"
        )

        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("error", respuesta.data)


    def test_crear_problema_completo(self):
        datos = {
            "nombre": "Nuevo problema",
            "descripcion": "Prueba de creación desde la API",
            "tipo_objetivo": "MAX",
            "variables": [
                {
                    "nombre": "x",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                },
                {
                    "nombre": "y",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                },
            ],
            "terminos_objetivo": [
                {
                    "variable_nombre": "x",
                    "coeficiente": "3",
                },
                {
                    "variable_nombre": "y",
                    "coeficiente": "5",
                },
            ],
            "restricciones": [
                {
                    "nombre": "capacidad",
                    "operador": "LE",
                    "lado_derecho": "12",
                    "terminos": [
                        {
                            "variable_nombre": "x",
                            "coeficiente": "2",
                        },
                        {
                            "variable_nombre": "y",
                            "coeficiente": "3",
                        },
                    ],
                },
            ],
        }

        respuesta = self.client.post(
            "/api/problemas/",
            datos,
            format="json",
        )

        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(respuesta.data["nombre"], "Nuevo problema")
        self.assertEqual(len(respuesta.data["variables"]), 2)
        self.assertEqual(
            len(respuesta.data["terminos_objetivo"]),
            2,
        )
        self.assertEqual(len(respuesta.data["restricciones"]), 1)

        problema_creado = ProblemaOptimizacion.objects.get(
            nombre="Nuevo problema"
        )
        self.assertEqual(problema_creado.propietario, self.user)
        self.assertEqual(problema_creado.variables.count(), 2)
        self.assertEqual(problema_creado.terminos_objetivo.count(), 2)
        self.assertEqual(problema_creado.restricciones.count(), 1)

    def test_rechazar_variable_inexistente(self):
        datos = {
            "nombre": "Problema inválido",
            "tipo_objetivo": "MAX",
            "variables": [
                {
                    "nombre": "x",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                },
            ],
            "terminos_objetivo": [
                {
                    "variable_nombre": "z",
                    "coeficiente": "5",
                },
            ],
            "restricciones": [],
        }

        respuesta = self.client.post(
            "/api/problemas/",
            datos,
            format="json",
        )

        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(
            ProblemaOptimizacion.objects.filter(
                nombre="Problema inválido"
            ).count(),
            0,
        )

    @override_settings(
        OPTIMIZER_MAX_VARIABLES=1,
        OPTIMIZER_MAX_CONSTRAINTS=1,
        OPTIMIZER_MAX_TERMS=10,
        OPTIMIZER_MAX_ABS_VALUE=1000,
    )
    def test_rechazar_modelo_que_supera_limite_de_variables(self):
        serializer = ProblemaOptimizacionCrearSerializer(data={
            "nombre": "Modelo excesivo",
            "variables": [
                {"nombre": "x", "tipo": "CONT"},
                {"nombre": "y", "tipo": "CONT"},
            ],
            "terminos_objetivo": [
                {"variable_nombre": "x", "coeficiente": "1"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("variables", serializer.errors)

    @override_settings(
        OPTIMIZER_MAX_VARIABLES=2,
        OPTIMIZER_MAX_CONSTRAINTS=1,
        OPTIMIZER_MAX_TERMS=10,
        OPTIMIZER_MAX_ABS_VALUE=1000,
    )
    def test_rechazar_coeficiente_fuera_de_rango(self):
        serializer = ProblemaOptimizacionCrearSerializer(data={
            "nombre": "Coeficiente excesivo",
            "variables": [{"nombre": "x", "tipo": "CONT"}],
            "terminos_objetivo": [
                {"variable_nombre": "x", "coeficiente": "1001"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)

    @override_settings(OPTIMIZER_MAX_VARIABLES=1)
    def test_solucionador_tambien_limita_modelos_existentes(self):
        ejecucion = resolver_problema(self.problema.pk)

        self.assertEqual(ejecucion.estado, "ERR")
        self.assertIn("límite de variables", ejecucion.mensaje)


class RegistroUsuarioTests(TestCase):
    def test_registro_requiere_csrf(self):
        client = Client(enforce_csrf_checks=True)

        respuesta = client.post(
            "/api/auth/registro/",
            data=json.dumps({
                "username": "nuevo",
                "password": "Fuerte-contraseña-739!",
            }),
            content_type="application/json",
        )

        self.assertEqual(respuesta.status_code, 403)

    def test_registro_crea_cuenta_pendiente_de_verificacion(self):
        client = Client(enforce_csrf_checks=True)
        client.get("/")
        token = client.cookies["csrftoken"].value

        respuesta = client.post(
            "/api/auth/registro/",
            data=json.dumps({
                "username": "nuevo",
                "email": "nuevo@example.com",
                "password": "Fuerte-contraseña-739!",
            }),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(respuesta.status_code, 201)
        usuario = get_user_model().objects.get(username="nuevo")
        self.assertFalse(usuario.is_active)
        self.assertEqual(client.get("/api/auth/me/").status_code, 401)

    def test_verificacion_activa_cuenta(self):
        usuario = get_user_model().objects.create_user(
            username="pendiente",
            email="pendiente@example.com",
            password="Fuerte-contraseña-739!",
            is_active=False,
        )
        token = signing.dumps(
            {"user_id": usuario.pk, "email": usuario.email},
            salt="optimizacion.email-verification",
        )

        respuesta = self.client.post(
            "/api/auth/verify/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )

        self.assertEqual(respuesta.status_code, 200)
        usuario.refresh_from_db()
        self.assertTrue(usuario.is_active)
        self.assertIsNotNone(usuario.verificacion_correo.verificado_en)

    def test_enlace_reutilizado_no_reactiva_cuenta_deshabilitada(self):
        usuario = get_user_model().objects.create_user(
            username="ya-verificado",
            email="verificado@example.com",
            password="Fuerte-contraseña-739!",
            is_active=True,
        )
        token = signing.dumps(
            {"user_id": usuario.pk, "email": usuario.email},
            salt="optimizacion.email-verification",
        )
        self.client.post(
            "/api/auth/verify/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )
        usuario.is_active = False
        usuario.save(update_fields=["is_active"])

        response = self.client.post(
            "/api/auth/verify/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        usuario.refresh_from_db()
        self.assertFalse(usuario.is_active)

    def test_restablecer_contrasena_con_token_valido(self):
        usuario = get_user_model().objects.create_user(
            username="reset-user",
            email="reset@example.com",
            password="Anterior-contraseña-739!",
        )
        response = self.client.post(
            "/api/auth/password-reset/confirm/",
            data=json.dumps({
                "uid": urlsafe_base64_encode(force_bytes(usuario.pk)),
                "token": default_token_generator.make_token(usuario),
                "password": "Nueva-contraseña-947!",
            }),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        usuario.refresh_from_db()
        self.assertTrue(usuario.check_password("Nueva-contraseña-947!"))

    def test_login_y_logout_requieren_sesion_csrf(self):
        usuario = get_user_model().objects.create_user(
            username="existente",
            password="Fuerte-contraseña-739!",
        )
        client = Client(enforce_csrf_checks=True)
        client.get("/")
        token = client.cookies["csrftoken"].value

        respuesta_login = client.post(
            "/api/auth/login/",
            data=json.dumps({
                "username": usuario.username,
                "password": "Fuerte-contraseña-739!",
            }),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        token = client.cookies["csrftoken"].value
        respuesta_logout = client.post(
            "/api/auth/logout/",
            data="{}",
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(respuesta_login.status_code, 200)
        self.assertEqual(respuesta_logout.status_code, 200)
        self.assertEqual(client.get("/api/auth/me/").status_code, 401)

    @override_settings(ALLOW_REGISTRATION=False)
    def test_registro_se_puede_desactivar(self):
        client = Client(enforce_csrf_checks=True)
        client.get("/")

        respuesta = client.post(
            "/api/auth/registro/",
            data=json.dumps({
                "username": "bloqueado",
                "password": "Fuerte-contraseña-739!",
            }),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )

        self.assertEqual(respuesta.status_code, 403)
        self.assertFalse(
            get_user_model().objects.filter(username="bloqueado").exists()
        )

    def test_registro_aplica_limite_por_direccion_ip(self):
        client = Client(enforce_csrf_checks=True)
        client.get("/")

        respuestas = []
        for _ in range(6):
            respuestas.append(client.post(
                "/api/auth/registro/",
                data=json.dumps({
                    "username": "nuevo",
                    "email": "nuevo@example.com",
                    "password": "Fuerte-contraseña-739!",
                }),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            ))

        self.assertEqual(respuestas[0].status_code, 201)
        self.assertEqual(
            respuestas[5].status_code,
            429,
            [respuesta.content for respuesta in respuestas],
        )


class PortfolioOptimizationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="portfolio-user",
            password="Fuerte-contraseña-739!",
        )
        self.client.force_authenticate(user=self.user)
        self.payload = {
            "nombre": "Cartera equilibrada",
            "activos": ["Bono", "Acción"],
            "rendimientos_esperados": ["0.10", "0.20"],
            "covarianza": [["0.04", "0"], ["0", "0.09"]],
            "aversion_riesgo": "2",
        }

    def test_media_varianza_respeta_restricciones_y_optimo(self):
        resultado = optimizar_media_varianza(
            [0.10, 0.20],
            [[0.04, 0], [0, 0.09]],
            2,
        )

        self.assertAlmostEqual(sum(resultado["ponderaciones"]), 1, places=8)
        self.assertAlmostEqual(resultado["ponderaciones"][0], 0.5, places=4)
        self.assertAlmostEqual(resultado["rendimientos_portafolio"], 0.15, places=5)
        self.assertAlmostEqual(resultado["varianza_portafolio"], 0.0325, places=5)

    def test_rechaza_covarianza_no_semidefinida_positiva(self):
        invalid = dict(self.payload)
        invalid["covarianza"] = [["1", "2"], ["2", "1"]]

        response = self.client.post(
            "/api/portafolios/",
            invalid,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("covarianza", response.data)

    def test_limites_por_activo_y_categoria_se_validan_y_aplican(self):
        payload = dict(
            self.payload,
            categorias=["Renta fija", "Acciones"],
            pesos_minimos=["0.25", "0"],
            pesos_maximos=["1", "1"],
            limites_categoria={"Acciones": "0.40"},
        )
        created = self.client.post(
            "/api/portafolios/",
            payload,
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)

        solved = self.client.post(
            f"/api/portafolios/{created.data['id']}/resolver/"
        )
        self.assertEqual(solved.status_code, 200, solved.data)
        weights = solved.data["ponderaciones"]
        self.assertGreaterEqual(weights[0], 0.25 - 1e-6)
        self.assertLessEqual(weights[1], 0.40 + 1e-6)
        self.assertAlmostEqual(sum(weights), 1, places=7)

    def test_frontera_eficiente_cumple_el_limite_de_categoria(self):
        frontier = calcular_frontera_eficiente(
            [0.04, 0.10],
            [[0.01, 0], [0, 0.04]],
            bounds=[(0.2, 1), (0, 1)],
            categorias=["Renta fija", "Acciones"],
            limites_categoria={"Acciones": 0.5},
            puntos=7,
        )

        self.assertEqual(len(frontier), 7)
        for point in frontier:
            self.assertAlmostEqual(sum(point["ponderaciones"]), 1, places=7)
            self.assertGreaterEqual(point["ponderaciones"][0], 0.2 - 1e-6)
            self.assertLessEqual(point["ponderaciones"][1], 0.5 + 1e-6)
        self.assertLessEqual(
            frontier[0]["rendimientos_portafolio"],
            frontier[-1]["rendimientos_portafolio"] + 1e-7,
        )

    def test_rechaza_limites_de_peso_incompatibles(self):
        payload = dict(
            self.payload,
            pesos_minimos=["0.7", "0.7"],
        )
        response = self.client.post(
            "/api/portafolios/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("pesos_minimos", response.data)

    def test_rechaza_topes_de_categoria_infactibles(self):
        payload = dict(
            self.payload,
            categorias=["Renta fija", "Acciones"],
            limites_categoria={"Renta fija": "0.3", "Acciones": "0.3"},
        )
        response = self.client.post(
            "/api/portafolios/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("limites_categoria", response.data)

    def test_metricas_anualizadas_aportaciones_y_estres(self):
        result = optimizar_media_varianza(
            [0.10, 0.20],
            [[0.04, 0], [0, 0.09]],
            2,
            periodos_por_anio=12,
            escenarios_estres={"Recesión": [-0.10, -0.20]},
        )

        self.assertAlmostEqual(result["rendimiento_anualizado"], 1.8, places=5)
        self.assertAlmostEqual(
            result["volatilidad_anualizada"],
            result["volatilidad_portafolio"] * (12 ** 0.5),
            places=7,
        )
        contributions = result["contribuciones_riesgo"]
        self.assertAlmostEqual(
            sum(item["proporcion_volatilidad"] for item in contributions),
            1,
            places=7,
        )
        self.assertAlmostEqual(
            result["resultados_estres"]["Recesión"],
            -0.15,
            places=5,
        )

    def test_previsualiza_importacion_csv_con_delimitador_punto_y_coma(self):
        csv_content = (
            "asset;expected_return;cov:Bonos;cov:Acciones;category;min_weight;max_weight\n"
            "Bonos;0.04;0.01;0;Renta fija;0.1;1\n"
            "Acciones;0.10;0;0.04;Renta variable;0;0.9\n"
        ).encode("utf-8")
        uploaded = SimpleUploadedFile(
            "cartera.csv",
            csv_content,
            content_type="text/csv",
        )

        response = self.client.post(
            "/api/portafolios/importar/preview/",
            {"archivo": uploaded, "nombre": "Desde CSV"},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.data)
        preview = response.data["preview"]
        self.assertEqual(preview["nombre"], "Desde CSV")
        self.assertEqual(preview["activos"], ["Bonos", "Acciones"])
        self.assertEqual(preview["categorias"], ["Renta fija", "Renta variable"])
        self.assertEqual(preview["pesos_minimos"], ["0.10000000", "0.00000000"])
        self.assertEqual(
            OptimizacionPortafolio.objects.count(),
            0,
            "La vista previa no debe guardar el portafolio.",
        )

    def test_previsualizacion_csv_rechaza_matriz_asimetrica(self):
        csv_content = (
            "asset,expected_return,cov:Bonos,cov:Acciones\n"
            "Bonos,0.04,0.01,0.02\n"
            "Acciones,0.10,0.01,0.04\n"
        ).encode("utf-8")
        uploaded = SimpleUploadedFile(
            "invalido.csv",
            csv_content,
            content_type="text/csv",
        )

        response = self.client.post(
            "/api/portafolios/importar/preview/",
            {"archivo": uploaded},
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("covarianza", response.data)

    def test_previsualizacion_csv_rechaza_codificacion_invalida(self):
        uploaded = SimpleUploadedFile(
            "invalido.csv",
            b"\xff\xfe\x00",
            content_type="text/csv",
        )
        response = self.client.post(
            "/api/portafolios/importar/preview/",
            {"archivo": uploaded},
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("archivo", response.data)

    def test_crea_resuelve_edita_y_preserva_historial(self):
        payload = dict(
            self.payload,
            periodos_por_anio=12,
            escenarios_estres={"Recesión": ["-0.10", "-0.20"]},
        )
        response = self.client.post(
            "/api/portafolios/",
            payload,
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        portfolio_id = response.data["id"]
        portfolio = OptimizacionPortafolio.objects.get(pk=portfolio_id)
        self.assertEqual(portfolio.propietario, self.user)
        self.assertEqual(portfolio.pesos_minimos, ["0", "0"])
        self.assertEqual(portfolio.pesos_maximos, ["1", "1"])

        solve = self.client.post(
            f"/api/portafolios/{portfolio_id}/resolver/"
        )
        self.assertEqual(solve.status_code, 200)
        self.assertEqual(EjecucionPortafolio.objects.filter(
            optimizacion=portfolio,
        ).count(), 1)

        edited = dict(self.payload, nombre="Cartera actualizada")
        update = self.client.put(
            f"/api/portafolios/{portfolio_id}/",
            edited,
            format="json",
        )
        history = self.client.get(
            f"/api/portafolios/{portfolio_id}/historial/"
        )

        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.data["nombre"], "Cartera actualizada")
        self.assertEqual(len(history.data), 1)
        self.assertEqual(history.data[0]["modelo_snapshot"]["nombre"], "Cartera equilibrada")
        self.assertEqual(
            history.data[0]["modelo_snapshot"]["periodos_por_anio"],
            12,
        )
        self.assertEqual(len(history.data[0]["contribuciones_riesgo"]), 2)
        self.assertAlmostEqual(
            history.data[0]["rendimiento_anualizado"],
            1.8,
            places=5,
        )
        self.assertAlmostEqual(
            history.data[0]["resultados_estres"]["Recesión"],
            -0.15,
            places=5,
        )

    def test_no_expone_portafolios_de_otros_usuarios(self):
        other_user = get_user_model().objects.create_user(
            username="other-portfolio-user",
            password="Fuerte-contraseña-739!",
        )
        portfolio = OptimizacionPortafolio.objects.create(
            propietario=other_user,
            **{
                **self.payload,
                "rendimientos_esperados": ["0.10", "0.20"],
                "covarianza": [["0.04", "0"], ["0", "0.09"]],
                "aversion_riesgo": "2",
            },
        )

        response = self.client.get(f"/api/portafolios/{portfolio.pk}/")

        self.assertEqual(response.status_code, 404)


class AccountDataTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="data-owner",
            email="data@example.com",
            password="Fuerte-contraseña-739!",
        )
        self.client.force_authenticate(user=self.user)

    def test_exporta_modelos_e_historial_sin_credenciales(self):
        problem = ProblemaOptimizacion.objects.create(
            propietario=self.user,
            nombre="Exportable",
        )
        response = self.client.get("/api/auth/export/")
        exported = json.loads(b"".join(response.streaming_content))

        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertEqual(exported["cuenta"]["username"], self.user.username)
        self.assertEqual(exported["problemas"][0]["nombre"], problem.nombre)
        self.assertNotIn("password", exported["cuenta"])
        self.assertIn("portafolios", exported)

    def test_eliminar_cuenta_exige_confirmacion_y_borra_datos_propios(self):
        problem = ProblemaOptimizacion.objects.create(
            propietario=self.user,
            nombre="Privado",
        )
        portfolio = OptimizacionPortafolio.objects.create(
            propietario=self.user,
            nombre="Privado financiero",
            activos=["Bono", "Acción"],
            categorias=["", ""],
            rendimientos_esperados=["0.1", "0.2"],
            covarianza=[["0.04", "0"], ["0", "0.09"]],
            aversion_riesgo="2",
        )

        wrong_confirmation = self.client.post(
            "/api/auth/delete/",
            {
                "password": "Fuerte-contraseña-739!",
                "confirmacion": "incorrecto",
            },
            format="json",
        )
        self.assertEqual(wrong_confirmation.status_code, 400)
        self.assertTrue(get_user_model().objects.filter(pk=self.user.pk).exists())

        deleted = self.client.post(
            "/api/auth/delete/",
            {
                "password": "Fuerte-contraseña-739!",
                "confirmacion": self.user.username,
            },
            format="json",
        )

        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(get_user_model().objects.filter(pk=self.user.pk).exists())
        self.assertFalse(ProblemaOptimizacion.objects.filter(pk=problem.pk).exists())
        self.assertFalse(OptimizacionPortafolio.objects.filter(pk=portfolio.pk).exists())

    def test_health_endpoint_informa_estado_de_base_de_datos(self):
        response = self.client.get("/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_cambiar_contrasena_verifica_la_anterior_y_mantiene_sesion(self):
        client = Client()
        self.assertTrue(client.login(
            username=self.user.username,
            password="Fuerte-contraseña-739!",
        ))
        response = client.post(
            "/api/auth/change-password/",
            {
                "old_password": "Fuerte-contraseña-739!",
                "new_password1": "Nueva-contraseña-947!",
                "new_password2": "Nueva-contraseña-947!",
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(client.get("/api/auth/me/").status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Nueva-contraseña-947!"))
