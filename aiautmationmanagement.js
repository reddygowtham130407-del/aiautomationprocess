import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


DATABASE_PATH = os.getenv("EAIP_DATABASE_PATH", "eaip.db")
CORS_ORIGINS = os.getenv(
    "EAIP_CORS_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5500",
).split(",")


def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    with get_db() as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS daily_sales (
                sale_date TEXT PRIMARY KEY,
                revenue REAL NOT NULL,
                profit REAL NOT NULL,
                orders INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inventory (
                sku TEXT PRIMARY KEY,
                product_name TEXT NOT NULL,
                in_stock INTEGER NOT NULL CHECK (in_stock >= 0),
                predicted_demand INTEGER NOT NULL CHECK (predicted_demand >= 0),
                reorder_point INTEGER NOT NULL CHECK (reorder_point >= 0),
                supplier TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS customer_segments (
                segment TEXT PRIMARY KEY,
                customer_count INTEGER NOT NULL CHECK (customer_count >= 0),
                average_lifetime_value REAL NOT NULL CHECK (average_lifetime_value >= 0),
                churn_risk_count INTEGER NOT NULL CHECK (churn_risk_count >= 0)
            );

            CREATE TABLE IF NOT EXISTS expenses (
                category TEXT PRIMARY KEY,
                amount REAL NOT NULL CHECK (amount >= 0),
                budget REAL NOT NULL CHECK (budget >= 0)
            );

            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_type TEXT NOT NULL,
                period_days INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )

        if db.execute("SELECT COUNT(*) FROM daily_sales").fetchone()[0] == 0:
            today = date.today()
            for offset in range(179, -1, -1):
                day = today - timedelta(days=offset)
                daily_factor = 1 + ((day.day % 9) - 4) * 0.012
                weekly_factor = 1.08 if day.weekday() < 5 else 0.82
                revenue = round((235_000 + (179 - offset) * 1_120) * daily_factor * weekly_factor, 2)
                profit = round(revenue * 0.216, 2)
                orders = max(10, int(revenue / 5_800))
                db.execute(
                    "INSERT INTO daily_sales VALUES (?, ?, ?, ?)",
                    (day.isoformat(), revenue, profit, orders),
                )

            now = datetime.now(timezone.utc).isoformat()
            db.executemany(
                """
                INSERT INTO inventory
                    (sku, product_name, in_stock, predicted_demand, reorder_point, supplier, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    ("LAP-014", "Laptop Pro 14", 25, 100, 40, "Northstar Supply", now),
                    ("MOU-220", "Wireless Mouse", 500, 150, 100, "Metro Components", now),
                    ("KEY-102", "Keyboard K2", 10, 80, 30, "Northstar Supply", now),
                    ("MON-440", "Monitor Ultra", 74, 60, 25, "DisplayWorks", now),
                    ("HUB-010", "USB-C Hub", 18, 45, 25, "Metro Components", now),
                ],
            )
            db.executemany(
                "INSERT INTO customer_segments VALUES (?, ?, ?, ?)",
                [
                    ("Enterprise", 1240, 82400, 35),
                    ("Growth", 4810, 28600, 165),
                    ("Emerging", 6400, 9800, 300),
                ],
            )
            db.executemany(
                "INSERT INTO expenses VALUES (?, ?, ?)",
                [
                    ("Operations", 2_240_000, 2_400_000),
                    ("Marketing", 1_210_000, 1_100_000),
                    ("Technology", 980_000, 1_050_000),
                    ("People", 1_840_000, 1_900_000),
                ],
            )
            db.executemany(
                "INSERT INTO activity_log (message, created_at) VALUES (?, ?)",
                [
                    ("Monthly revenue forecast updated", now),
                    ("Three inventory items need review", now),
                    ("Finance summary is ready", now),
                ],
            )


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="EAIP — Enterprise AI Intelligence Platform",
    version="1.0.0",
    description="Starter API for the EAIP dashboard. Seeded values are illustrative demo data.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in CORS_ORIGINS if origin.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


class ReportRequest(BaseModel):
    report_type: str = Field(default="business-summary", min_length=3, max_length=50)
    period_days: int = Field(default=30, ge=7, le=365)


class AssistantRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)


def sales_totals(start: date, end: date) -> dict:
    with get_db() as db:
        row = db.execute(
            """
            SELECT COALESCE(SUM(revenue), 0) AS revenue,
                   COALESCE(SUM(profit), 0) AS profit,
                   COALESCE(SUM(orders), 0) AS orders
            FROM daily_sales
            WHERE sale_date >= ? AND sale_date <= ?
            """,
            (start.isoformat(), end.isoformat()),
        ).fetchone()
    return dict(row)


def percent_change(current: float, previous: float) -> float:
    if previous == 0:
        return 0.0
    return round(((current - previous) / previous) * 100, 1)


def inventory_records() -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            """
            SELECT sku, product_name, in_stock, predicted_demand, reorder_point,
                   supplier, updated_at
            FROM inventory
            ORDER BY CASE WHEN in_stock <= reorder_point THEN 0 ELSE 1 END,
                     product_name
            """
        ).fetchall()

    records = []
    for row in rows:
        item = dict(row)
        item["status"] = (
            "urgent" if item["in_stock"] <= item["reorder_point"] // 2
            else "reorder" if item["in_stock"] <= item["reorder_point"]
            else "healthy"
        )
        records.append(item)
    return records


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "eaip-api"}


@app.get("/api/dashboard")
def dashboard(days: int = Query(default=30, ge=7, le=365)) -> dict:
    today = date.today()
    start = today - timedelta(days=days - 1)
    previous_start = start - timedelta(days=days)
    previous_end = start - timedelta(days=1)

    current = sales_totals(start, today)
    previous = sales_totals(previous_start, previous_end)

    with get_db() as db:
        customer = db.execute(
            """
            SELECT COALESCE(SUM(customer_count), 0) AS total,
                   COALESCE(SUM(churn_risk_count), 0) AS churn_risk
            FROM customer_segments
            """
        ).fetchone()
        departments = db.execute(
            "SELECT category, amount, budget FROM expenses ORDER BY amount DESC"
        ).fetchall()
        activity = db.execute(
            "SELECT message, created_at FROM activity_log ORDER BY id DESC LIMIT 5"
        ).fetchall()

    inventory = inventory_records()
    alerts = sum(item["status"] != "healthy" for item in inventory)
    risk_score = min(100, 12 + alerts * 4)

    series = []
    with get_db() as db:
        rows = db.execute(
            """
            SELECT sale_date, revenue, profit, orders
            FROM daily_sales
            WHERE sale_date >= ? AND sale_date <= ?
            ORDER BY sale_date
            """,
            (start.isoformat(), today.isoformat()),
        ).fetchall()
    for row in rows:
        series.append(dict(row))

    return {
        "period_days": days,
        "as_of": today.isoformat(),
        "kpis": {
            "total_revenue": round(current["revenue"], 2),
            "net_profit": round(current["profit"], 2),
            "active_customers": customer["total"],
            "business_risk_score": risk_score,
            "revenue_change_pct": percent_change(current["revenue"], previous["revenue"]),
            "profit_change_pct": percent_change(current["profit"], previous["profit"]),
            "customer_churn_risk_count": customer["churn_risk"],
            "orders": current["orders"],
        },
        "revenue_series": series,
        "department_revenue": [
            {
                "department": row["category"],
                "amount": row["amount"],
                "budget": row["budget"],
            }
            for row in departments
        ],
        "inventory_alerts": [item for item in inventory if item["status"] != "healthy"],
        "recent_activity": [dict(row) for row in activity],
        "demo_data": True,
    }


@app.get("/api/sales")
def sales(
    days: int = Query(default=30, ge=7, le=365),
    forecast_days: int = Query(default=30, ge=7, le=180),
) -> dict:
    today = date.today()
    start = today - timedelta(days=days - 1)

    with get_db() as db:
        rows = db.execute(
            """
            SELECT sale_date, revenue, profit, orders
            FROM daily_sales
            WHERE sale_date >= ? AND sale_date <= ?
            ORDER BY sale_date
            """,
            (start.isoformat(), today.isoformat()),
        ).fetchall()

    history = [dict(row) for row in rows]
    if not history:
        raise HTTPException(status_code=404, detail="No sales data is available for this period.")

    recent = history[-min(7, len(history)):]
    average_daily_revenue = sum(row["revenue"] for row in recent) / len(recent)
    forecast_revenue = round(average_daily_revenue * forecast_days, 2)

    return {
        "history": history,
        "forecast": {
            "horizon_days": forecast_days,
            "estimated_revenue": forecast_revenue,
            "lower_estimate": round(forecast_revenue * 0.9, 2),
            "upper_estimate": round(forecast_revenue * 1.1, 2),
            "method": "recent daily average; illustrative baseline, not a trained ML model",
        },
        "demo_data": True,
    }


@app.get("/api/inventory")
def get_inventory() -> dict:
    items = inventory_records()
    return {
        "items": items,
        "alert_count": sum(item["status"] != "healthy" for item in items),
        "demo_data": True,
    }


@app.get("/api/customers")
def get_customers() -> dict:
    with get_db() as db:
        rows = db.execute(
            """
            SELECT segment, customer_count, average_lifetime_value, churn_risk_count
            FROM customer_segments
            ORDER BY customer_count DESC
            """
        ).fetchall()

    segments = [dict(row) for row in rows]
    return {
        "segments": segments,
        "totals": {
            "active_customers": sum(item["customer_count"] for item in segments),
            "churn_risk_count": sum(item["churn_risk_count"] for item in segments),
        },
        "demo_data": True,
    }


@app.get("/api/finance")
def get_finance() -> dict:
    with get_db() as db:
        rows = db.execute(
            "SELECT category, amount, budget FROM expenses ORDER BY amount DESC"
        ).fetchall()

    expenses = [dict(row) for row in rows]
    return {
        "expenses": expenses,
        "total_expenses": round(sum(item["amount"] for item in expenses), 2),
        "total_budget": round(sum(item["budget"] for item in expenses), 2),
        "demo_data": True,
    }


@app.get("/api/reports")
def list_reports(limit: int = Query(default=20, ge=1, le=100)) -> dict:
    with get_db() as db:
        rows = db.execute(
            """
            SELECT id, report_type, period_days, created_at
            FROM reports
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return {"reports": [dict(row) for row in rows]}


@app.post("/api/reports", status_code=201)
def create_report(request: ReportRequest) -> dict:
    end = date.today()
    start = end - timedelta(days=request.period_days - 1)
    totals = sales_totals(start, end)

    with get_db() as db:
        inventory = inventory_records()
        customer = db.execute(
            """
            SELECT COALESCE(SUM(customer_count), 0) AS total,
                   COALESCE(SUM(churn_risk_count), 0) AS churn_risk
            FROM customer_segments
            """
        ).fetchone()

        content = {
            "title": request.report_type,
            "period": {"from": start.isoformat(), "to": end.isoformat()},
            "revenue": round(totals["revenue"], 2),
            "profit": round(totals["profit"], 2),
            "orders": totals["orders"],
            "active_customers": customer["total"],
            "customers_with_churn_signals": customer["churn_risk"],
            "inventory_alerts": [
                item["product_name"] for item in inventory if item["status"] != "healthy"
            ],
            "demo_data": True,
        }
        created_at = datetime.now(timezone.utc).isoformat()
        cursor = db.execute(
            """
            INSERT INTO reports (report_type, period_days, content, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (request.report_type, request.period_days, __import__("json").dumps(content), created_at),
        )
        report_id = cursor.lastrowid

    return {"id": report_id, "created_at": created_at, "report": content}


@app.get("/api/governance")
def get_governance() -> dict:
    return {
        "models": [
            {
                "name": "Revenue Forecast",
                "use_case": "Sales prediction",
                "version": "demo-1",
                "status": "illustrative",
                "accuracy": None,
            },
            {
                "name": "Customer Signals",
                "use_case": "Retention analysis",
                "version": "demo-1",
                "status": "illustrative",
                "accuracy": None,
            },
            {
                "name": "Demand Planner",
                "use_case": "Inventory forecasting",
                "version": "demo-1",
                "status": "illustrative",
                "accuracy": None,
            },
        ],
        "note": "No trained models are connected to this starter backend.",
    }


@app.post("/api/assistant")
def ask_assistant(request: AssistantRequest) -> dict:
    question = request.question.strip().lower()

    if any(word in question for word in ("inventory", "stock", "reorder", "product")):
        items = inventory_records()
        alerts = [item for item in items if item["status"] != "healthy"]
        return {
            "answer": f"{len(alerts)} inventory item(s) are at or below their reorder point.",
            "data": alerts,
            "source": "inventory",
            "demo_data": True,
        }

    if any(word in question for word in ("customer", "churn", "retention")):
        with get_db() as db:
            row = db.execute(
                """
                SELECT COALESCE(SUM(customer_count), 0) AS customers,
                       COALESCE(SUM(churn_risk_count), 0) AS churn_risk
                FROM customer_segments
                """
            ).fetchone()
        return {
            "answer": (
                f"There are {row['customers']:,} active customers in the demo data; "
                f"{row['churn_risk']:,} have elevated churn signals."
            ),
            "data": dict(row),
            "source": "customer_segments",
            "demo_data": True,
        }

    if any(word in question for word in ("expense", "budget", "finance", "profit")):
        finance = get_finance()
        return {
            "answer": (
                f"Recorded expenses total ₹{finance['total_expenses']:,.0f} "
                f"against a budget of ₹{finance['total_budget']:,.0f}."
            ),
            "data": finance,
            "source": "expenses",
            "demo_data": True,
        }

    if any(word in question for word in ("revenue", "sales", "forecast", "sale")):
        data = sales(days=30, forecast_days=30)
        current_total = round(sum(row["revenue"] for row in data["history"]), 2)
        return {
            "answer": (
                f"Revenue in the available 30-day sample is ₹{current_total:,.0f}. "
                f"The simple 30-day baseline forecast is "
                f"₹{data['forecast']['estimated_revenue']:,.0f}."
            ),
            "data": data,
            "source": "daily_sales",
            "demo_data": True,
        }

    return {
        "answer": (
            "I can summarize demo revenue, expenses, customers, or inventory. "
            "Connect an approved analytics or language-model service for broader questions."
        ),
        "data": None,
        "source": "help",
        "demo_data": True,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("EAIP_HOST", "127.0.0.1"),
        port=int(os.getenv("EAIP_PORT", "8000")),
        reload=os.getenv("EAIP_RELOAD", "false").lower() == "true",
    )