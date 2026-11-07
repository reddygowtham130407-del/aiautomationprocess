-- SQLite database schema and illustrative seed data for the EAIP FastAPI backend.
-- Save as schema.sql, then run: sqlite3 eaip.db < schema.sql

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS daily_sales (
    sale_date TEXT PRIMARY KEY,
    revenue   REAL NOT NULL CHECK (revenue >= 0),
    profit    REAL NOT NULL CHECK (profit >= 0),
    orders    INTEGER NOT NULL CHECK (orders >= 0)
);

CREATE TABLE IF NOT EXISTS inventory (
    sku             TEXT PRIMARY KEY,
    product_name    TEXT NOT NULL,
    in_stock        INTEGER NOT NULL CHECK (in_stock >= 0),
    predicted_demand INTEGER NOT NULL CHECK (predicted_demand >= 0),
    reorder_point   INTEGER NOT NULL CHECK (reorder_point >= 0),
    supplier        TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_segments (
    segment                  TEXT PRIMARY KEY,
    customer_count           INTEGER NOT NULL CHECK (customer_count >= 0),
    average_lifetime_value   REAL NOT NULL CHECK (average_lifetime_value >= 0),
    churn_risk_count         INTEGER NOT NULL CHECK (churn_risk_count >= 0)
);

CREATE TABLE IF NOT EXISTS expenses (
    category TEXT PRIMARY KEY,
    amount   REAL NOT NULL CHECK (amount >= 0),
    budget   REAL NOT NULL CHECK (budget >= 0)
);

CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL,
    period_days INTEGER NOT NULL CHECK (period_days BETWEEN 7 AND 365),
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_sales_date
    ON daily_sales(sale_date);

CREATE INDEX IF NOT EXISTS idx_reports_created_at
    ON reports(created_at);

-- Generate 180 days of illustrative sales data if the table is empty.
WITH RECURSIVE days(n, sale_date) AS (
    SELECT 0, date('now', '-179 days')
    UNION ALL
    SELECT n + 1, date(sale_date, '+1 day')
    FROM days
    WHERE n < 179
)
INSERT INTO daily_sales (sale_date, revenue, profit, orders)
SELECT
    sale_date,
    ROUND(
        (235000 + n * 1120)
        * (1 + ((CAST(strftime('%d', sale_date) AS INTEGER) % 9) - 4) * 0.012)
        * CASE
            WHEN strftime('%w', sale_date) IN ('0', '6') THEN 0.82
            ELSE 1.08
          END,
        2
    ),
    ROUND(
        (235000 + n * 1120)
        * (1 + ((CAST(strftime('%d', sale_date) AS INTEGER) % 9) - 4) * 0.012)
        * CASE
            WHEN strftime('%w', sale_date) IN ('0', '6') THEN 0.82
            ELSE 1.08
          END
        * 0.216,
        2
    ),
    MAX(
        10,
        CAST(
            (
                (235000 + n * 1120)
                * (1 + ((CAST(strftime('%d', sale_date) AS INTEGER) % 9) - 4) * 0.012)
                * CASE
                    WHEN strftime('%w', sale_date) IN ('0', '6') THEN 0.82
                    ELSE 1.08
                  END
            ) / 5800
            AS INTEGER
        )
    )
FROM days
WHERE NOT EXISTS (SELECT 1 FROM daily_sales);

INSERT OR IGNORE INTO inventory
    (sku, product_name, in_stock, predicted_demand, reorder_point, supplier, updated_at)
VALUES
    ('LAP-014', 'Laptop Pro 14', 25, 100, 40, 'Northstar Supply', datetime('now')),
    ('MOU-220', 'Wireless Mouse', 500, 150, 100, 'Metro Components', datetime('now')),
    ('KEY-102', 'Keyboard K2', 10, 80, 30, 'Northstar Supply', datetime('now')),
    ('MON-440', 'Monitor Ultra', 74, 60, 25, 'DisplayWorks', datetime('now')),
    ('HUB-010', 'USB-C Hub', 18, 45, 25, 'Metro Components', datetime('now'));

INSERT OR IGNORE INTO customer_segments
    (segment, customer_count, average_lifetime_value, churn_risk_count)
VALUES
    ('Enterprise', 1240, 82400, 35),
    ('Growth', 4810, 28600, 165),
    ('Emerging', 6400, 9800, 300);

INSERT OR IGNORE INTO expenses (category, amount, budget)
VALUES
    ('Operations', 2240000, 2400000),
    ('Marketing', 1210000, 1100000),
    ('Technology', 980000, 1050000),
    ('People', 1840000, 1900000);

INSERT INTO activity_log (message, created_at)
SELECT 'Monthly revenue forecast updated', datetime('now')
WHERE NOT EXISTS (
    SELECT 1 FROM activity_log WHERE message = 'Monthly revenue forecast updated'
);

INSERT INTO activity_log (message, created_at)
SELECT 'Three inventory items need review', datetime('now')
WHERE NOT EXISTS (
    SELECT 1 FROM activity_log WHERE message = 'Three inventory items need review'
);

INSERT INTO activity_log (message, created_at)
SELECT 'Finance summary is ready', datetime('now')
WHERE NOT EXISTS (
    SELECT 1 FROM activity_log WHERE message = 'Finance summary is ready'
);

COMMIT;