"""Pruebas: Configuración de planes de suscripción."""

import json

from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase
from rest_framework.test import APIClient

from config.subscription_plans import load_subscription_plans


class SubscriptionPlansTests(TestCase):
    def test_planes_se_muestran_con_limites_y_precios_configurados(self):
        response = APIClient().get("/api/planes/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [plan["name"] for plan in response.data],
            ["Inicial", "Profesional", "Profesional Pro"],
        )
        self.assertEqual(response.data[0]["price"], 0)
        self.assertEqual(response.data[0]["currency"], "USD")
        self.assertEqual(response.data[1]["price"], 3.95)
        self.assertEqual(response.data[1]["currency"], "USD")
        self.assertEqual(response.data[2]["price"], 10.5)
        self.assertEqual(response.data[2]["currency"], "USD")
        self.assertTrue(all(plan["interval"] == "monthly" for plan in response.data))
        self.assertIn("Hasta 3 modelos de optimización", response.data[0]["features"])
        self.assertIn("Hasta 50 activos por portafolio", response.data[1]["features"])
        self.assertIn("Hasta 100 activos por portafolio", response.data[2]["features"])

    def test_configuracion_de_planes_rechaza_ids_duplicados(self):
        plan = load_subscription_plans("")[0]
        with self.assertRaises(ImproperlyConfigured):
            load_subscription_plans(json.dumps([plan, plan]))

    def test_configuracion_de_planes_acepta_precio_y_moneda(self):
        plans = [{
            "id": "personal",
            "name": "Personal",
            "description": "Uso individual.",
            "price": 19.99,
            "currency": "USD",
            "interval": "monthly",
            "features": ["Modelos"],
            "featured": False,
        }]

        self.assertEqual(
            load_subscription_plans(json.dumps(plans)),
            plans,
        )

    def test_limits_es_opcional_y_se_valida(self):
        base = {
            "id": "basico",
            "name": "Básico",
            "description": "",
            "price": 0,
            "currency": "USD",
            "interval": "monthly",
            "features": [],
            "featured": False,
        }
        valid = dict(base, limits={"models": 5, "portfolios": None})
        self.assertEqual(
            load_subscription_plans(json.dumps([valid]))[0]["limits"]["models"], 5
        )
        for limits in (
            {"modelos": 5},
            {"models": -1},
            {"models": True},
            {"models": 2.5},
            [],
        ):
            with self.subTest(limits=limits), self.assertRaises(ImproperlyConfigured):
                load_subscription_plans(json.dumps([dict(base, limits=limits)]))
